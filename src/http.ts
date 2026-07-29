import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pino from "pino";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./index.js";
import { loadConfig, type AuthenticatedConfig, type Config } from "./config.js";

type ExchangeIdentity = {
  id: string;
  tenantId: string;
  accessToken: string;
};

type McpSession = {
  id?: string;
  tokenHash: string;
  userId: string;
  organizationId: string;
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpServer>;
  lastActivity: number;
};

const MAX_BODY_BYTES = 1_048_576;
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

function requestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

function bearerToken(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : undefined;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, { error: message });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("MCP request body exceeds the 1 MB limit");
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function exchangeIdentity(config: Config, token: string): Promise<ExchangeIdentity> {
  const response = await fetch(`${config.ANDIORA_API_URL}/api/v1/auth/mcp/exchange`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => ({})) as {
    accessToken?: unknown;
    user?: { id?: unknown; tenantId?: unknown };
  };
  if (!response.ok || typeof payload.accessToken !== "string" || !payload.user || typeof payload.user.id !== "string" || typeof payload.user.tenantId !== "string") {
    throw new Error("MCP identity exchange was rejected");
  }
  return { id: payload.user.id, tenantId: payload.user.tenantId, accessToken: payload.accessToken };
}

function rateLimitKey(request: IncomingMessage, token: string): string {
  const address = request.socket.remoteAddress ?? "unknown";
  return createHash("sha256").update(`${address}:${token}`).digest("hex");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createHttpGateway(config: Config) {
  const logger = pino({ level: config.LOG_LEVEL, redact: ["*.token", "*.authorization", "*.cookie", "*.secret"] });
  const sessions = new Map<string, McpSession>();
  const requestTimes = new Map<string, number[]>();

  const allowRequest = (request: IncomingMessage, token: string): boolean => {
    const key = rateLimitKey(request, token);
    const now = Date.now();
    const times = requestTimes.get(key) ?? [];
    while (times[0] !== undefined && now - times[0] > RATE_WINDOW_MS) times.shift();
    if (times.length >= RATE_LIMIT) return false;
    times.push(now);
    requestTimes.set(key, times);
    return true;
  };

  const closeSession = async (session: McpSession): Promise<void> => {
    if (session.id) sessions.delete(session.id);
    await session.server.close().catch(() => undefined);
  };

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = requestPath(request);
    if (path === "/health" && request.method === "GET") {
      sendJson(response, 200, { status: "ok", service: "andiora-dev-mcp-http" });
      return;
    }
    if (path !== config.MCP_HTTP_PATH) {
      sendError(response, 404, "Not found");
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id",
        "Access-Control-Allow-Methods": "DELETE, GET, OPTIONS, POST",
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }
    if (request.method !== "POST" && request.method !== "GET" && request.method !== "DELETE") {
      sendError(response, 405, "Method not allowed");
      return;
    }

    const token = bearerToken(request);
    if (!token) {
      sendError(response, 401, "Bearer authentication required");
      return;
    }
    if (!allowRequest(request, token)) {
      sendError(response, 429, "MCP rate limit exceeded");
      return;
    }

    const sessionId = request.headers["mcp-session-id"];
    const requestedSessionId = typeof sessionId === "string" ? sessionId : undefined;
    let session = requestedSessionId ? sessions.get(requestedSessionId) : undefined;

    if (requestedSessionId && !session) {
      sendError(response, 404, "MCP session not found");
      return;
    }
    let identity: ExchangeIdentity | undefined;
    if (session) {
      if (session.tokenHash !== tokenHash(token)) {
        sendError(response, 403, "MCP session identity mismatch");
        return;
      }
    } else {
      identity = await exchangeIdentity(config, token).catch(() => undefined);
      if (!identity) {
        sendError(response, 401, "MCP identity could not be verified");
        return;
      }
    }
    if (!session) {
      if (!identity) {
        sendError(response, 401, "MCP identity could not be verified");
        return;
      }
      if (request.method !== "POST") {
        sendError(response, 400, "A new MCP session must start with POST");
        return;
      }

      let pendingSession: McpSession | undefined;
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          if (pendingSession) {
            pendingSession.id = id;
            sessions.set(id, pendingSession);
          }
        },
        onsessionclosed: (id) => {
          const closed = sessions.get(id);
          if (closed) void closeSession(closed);
        },
      });
      const authenticatedConfig: AuthenticatedConfig = {
        ...config,
        ANDIORA_ACCESS_TOKEN: identity.accessToken,
        ANDIORA_ORGANIZATION_ID: identity.tenantId,
      };
      const server = createMcpServer(authenticatedConfig, { readOnly: true });
      pendingSession = {
        tokenHash: tokenHash(token),
        userId: identity.id,
        organizationId: identity.tenantId,
        transport,
        server,
        lastActivity: Date.now(),
      };
      session = pendingSession;
      await server.connect(transport);
    }

    session.lastActivity = Date.now();
    try {
      const body = request.method === "POST" ? await readJson(request) : undefined;
      await session.transport.handleRequest(request, response, body);
    } catch (error) {
      logger.warn({ err: error, organizationId: session.organizationId }, "MCP HTTP request failed");
      if (!response.headersSent) sendError(response, 400, "Invalid MCP request");
    }
  };

  const server = createServer(handler);
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - 15 * 60_000;
    for (const session of sessions.values()) {
      if (session.lastActivity < cutoff) void closeSession(session);
    }
  }, 60_000);
  cleanup.unref();
  return server;
}

const config = loadConfig();
const server = createHttpGateway(config);
server.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, () => {
  process.stdout.write(`Andiora MCP HTTPS gateway listening on http://${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}${config.MCP_HTTP_PATH}\n`);
});

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { Config } from "./config.js";

interface OidcMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
}

interface ExchangeResponse {
  accessToken: string;
  expiresIn: number;
  user: { id: string; tenantId: string; role: string; email: string; name: string };
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function secureEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function discover(issuer: string): Promise<OidcMetadata> {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Cognito OIDC discovery failed (${response.status})`);
  const metadata = await response.json() as Partial<OidcMetadata>;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error("Cognito OIDC metadata is incomplete");
  return metadata as OidcMetadata;
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function callbackHtml(success: boolean, message: string): string {
  const escaped = message.replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value] ?? value);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Andiora MCP</title></head><body style="font-family:system-ui;max-width:38rem;margin:4rem auto;padding:1rem"><h1>${success ? "Andiora MCP conectado" : "No se pudo autenticar"}</h1><p>${escaped}</p><p>Ya puedes cerrar esta ventana.</p></body></html>`;
}

/**
 * Authenticate the local stdio process with OAuth Authorization Code + PKCE.
 * The access token is held only in memory and is never written to disk.
 */
export async function loginWithCognito(config: Config): Promise<string> {
  if (!config.MCP_OIDC_ISSUER || !config.MCP_OIDC_CLIENT_ID) throw new Error("MCP Cognito OIDC configuration is incomplete");
  const issuer = config.MCP_OIDC_ISSUER;
  const clientId = config.MCP_OIDC_CLIENT_ID;
  const metadata = await discover(issuer);
  const state = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(48));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const callbackUrl = `http://127.0.0.1:${config.MCP_OIDC_CALLBACK_PORT}/oauth/callback`;

  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("scope", config.MCP_OIDC_SCOPES);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  const server = createServer();
  const result = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("MCP browser authentication timed out"));
    }, 5 * 60_000);

    server.on("request", async (request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "/", callbackUrl);
        if (requestUrl.pathname !== "/oauth/callback") {
          response.writeHead(404).end();
          return;
        }
        const returnedState = requestUrl.searchParams.get("state") ?? "";
        if (!secureEquals(returnedState, state)) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackHtml(false, "La validación de seguridad expiró o no coincide."));
          clearTimeout(timeout);
          server.close();
          reject(new Error("MCP OAuth state validation failed"));
          return;
        }
        const error = requestUrl.searchParams.get("error");
        if (error) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackHtml(false, "El proveedor de identidad rechazó el inicio de sesión."));
          clearTimeout(timeout);
          server.close();
          reject(new Error(`Cognito OAuth authorization failed: ${error}`));
          return;
        }
        const code = requestUrl.searchParams.get("code");
        if (!code) throw new Error("Cognito OAuth callback did not include an authorization code");

        const tokenResponse = await fetch(metadata.token_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            code,
            redirect_uri: callbackUrl,
            code_verifier: verifier,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        const tokenPayload = await tokenResponse.json().catch(() => ({})) as { id_token?: unknown };
        if (!tokenResponse.ok || typeof tokenPayload.id_token !== "string") throw new Error("Cognito token exchange failed");

        const exchangeResponse = await fetch(`${config.ANDIORA_API_URL}/api/v1/auth/mcp/exchange`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenPayload.id_token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(15_000),
        });
        const exchangePayload = await exchangeResponse.json().catch(() => ({})) as Partial<ExchangeResponse> & { error?: string };
        if (!exchangeResponse.ok || typeof exchangePayload.accessToken !== "string") {
          throw new Error(exchangePayload.error || "Andiora MCP identity exchange failed");
        }

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(callbackHtml(true, "La identidad fue verificada por Andiora."));
        clearTimeout(timeout);
        server.close();
        resolve(exchangePayload.accessToken);
      } catch (error) {
        response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" }).end(callbackHtml(false, "La autenticación no pudo completarse."));
        clearTimeout(timeout);
        server.close();
        reject(error instanceof Error ? error : new Error("MCP OAuth authentication failed"));
      }
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`MCP OAuth callback server failed: ${error.message}`));
    });
    server.listen(config.MCP_OIDC_CALLBACK_PORT, "127.0.0.1", () => openBrowser(authorizationUrl.toString()));
  });

  return result;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pino from "pino";
import { z } from "zod";
import { AndioraApiClient } from "./api-client.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, redact: ["*.token", "*.authorization", "*.cookie", "*.secret"] });
const api = new AndioraApiClient(config);
const server = new McpServer({ name: "andiora-dev-mcp", version: "0.1.0" });

const tenantInput = { organizationId: z.string().min(1).optional() };
function organizationId(input: { organizationId?: string }): string {
  const value = input.organizationId ?? config.ANDIORA_ORGANIZATION_ID;
  if (!value) throw new Error("organizationId is required for this session");
  if (config.ANDIORA_ORGANIZATION_ID && value !== config.ANDIORA_ORGANIZATION_ID) throw new Error("Tenant boundary violation");
  return value;
}

server.registerTool("get_organization_status", {
  description: "Read the authenticated organization status and active projects.",
  inputSchema: tenantInput,
}, async (input) => {
  const organizationIdValue = organizationId(input);
  logger.info({ tool: "get_organization_status", organizationId: organizationIdValue }, "MCP tool call");
  const result = await api.get(`/api/v1/organizations/${encodeURIComponent(organizationIdValue)}`);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("get_project_roadmap", {
  description: "Read a tenant-scoped project roadmap.",
  inputSchema: { organizationId: z.string().min(1).optional(), projectId: z.string().min(1) },
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const result = await api.get(`/api/v1/projects/${encodeURIComponent(input.projectId)}/milestones`);
  logger.info({ tool: "get_project_roadmap", organizationId: organizationIdValue, projectId: input.projectId }, "MCP tool call");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("get_health_diagnostics", {
  description: "Read platform health diagnostics without exposing secrets.",
  inputSchema: tenantInput,
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const result = await api.get("/api/v1/health", { organizationId: organizationIdValue });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

await server.connect(new StdioServerTransport());

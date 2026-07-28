import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import pino from "pino";
import { z } from "zod";
import { AndioraApiClient } from "./api-client.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, redact: ["*.token", "*.authorization", "*.cookie", "*.secret"] });
const api = new AndioraApiClient(config);
const server = new McpServer({ name: "andiora-dev-mcp", version: "0.1.0" });

const tenantInput = { organizationId: z.string().min(1).optional() };
const projectFilterInput = { ...tenantInput, projectId: z.string().min(1).optional() };
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
  // The platform exposes organizations as a tenant-scoped collection; individual GET is not a route.
  const result = await api.get("/api/v1/organizations");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("get_project_roadmap", {
  description: "Read a tenant-scoped project roadmap.",
  inputSchema: { organizationId: z.string().min(1).optional(), projectId: z.string().min(1) },
}, async (input) => {
  const organizationIdValue = organizationId(input);
  // Projects are returned with their milestones by the collection endpoint.
  const result = await api.get("/api/v1/projects");
  logger.info({ tool: "get_project_roadmap", organizationId: organizationIdValue, projectId: input.projectId }, "MCP tool call");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("list_projects", {
  description: "List projects visible to the authenticated employee and their organization scope.",
  inputSchema: tenantInput,
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const result = await api.get("/api/v1/projects");
  logger.info({ tool: "list_projects", organizationId: organizationIdValue }, "MCP tool call");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("list_documents", {
  description: "List tenant-scoped documents without returning file contents or secrets.",
  inputSchema: projectFilterInput,
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const result = await api.get("/api/v1/documents", { projectId: input.projectId });
  logger.info({ tool: "list_documents", organizationId: organizationIdValue }, "MCP tool call");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("create_markdown_document", {
  description: "Create and upload a tenant-scoped Markdown document as a DRAFT for human review.",
  inputSchema: {
    organizationId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    title: z.string().min(1).max(200),
    filename: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.(md|markdown)$/i),
    content: z.string().min(1).max(2 * 1024 * 1024),
    category: z.enum(["MANUAL", "ARCHITECTURE", "SECURITY", "TECHNICAL"]).default("TECHNICAL"),
    accessScope: z.enum(["CLIENT_SHARED", "INTERNAL_ADMIN"]).default("INTERNAL_ADMIN"),
  },
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const fileSize = Buffer.byteLength(input.content, "utf8");
  if (fileSize > 2 * 1024 * 1024) throw new Error("Markdown content exceeds the 2 MB limit");
  const created = await api.post<{ data: { id: string; title: string }; uploadUrl: string | null }>("/api/v1/documents", {
    organizationId: organizationIdValue,
    projectId: input.projectId,
    title: input.title,
    filename: input.filename,
    mimeType: "text/markdown",
    fileSize,
    category: input.category,
    accessScope: input.accessScope,
  }, randomUUID());
  if (!created.uploadUrl) throw new Error("Markdown storage is not provisioned in this stage");
  await api.putPresigned(created.uploadUrl, input.content);
  const confirmed = await api.put<{ data: unknown }>(`/api/v1/documents/${created.data.id}`, { action: "confirm-upload", fileSize, status: "DRAFT" }, randomUUID());
  logger.info({ tool: "create_markdown_document", organizationId: organizationIdValue, documentId: created.data.id }, "MCP tool call");
  return { content: [{ type: "text", text: JSON.stringify({ document: confirmed.data, status: "DRAFT", message: "Markdown document uploaded and saved as a draft for review" }) }] };
});

server.registerTool("list_deliverables", {
  description: "List tenant-scoped project deliverables and their approval status.",
  inputSchema: projectFilterInput,
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const result = await api.get("/api/v1/deliverables", { projectId: input.projectId });
  logger.info({ tool: "list_deliverables", organizationId: organizationIdValue }, "MCP tool call");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("list_tickets", {
  description: "List tenant-scoped support tickets and statuses.",
  inputSchema: projectFilterInput,
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const result = await api.get("/api/v1/tickets", { projectId: input.projectId });
  logger.info({ tool: "list_tickets", organizationId: organizationIdValue }, "MCP tool call");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("get_analytics_summary", {
  description: "Read tenant-scoped analytics summaries for an optional project and time range.",
  inputSchema: { ...projectFilterInput, timeRange: z.enum(["24h", "7d", "30d", "90d"]).default("30d") },
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const result = await api.get("/api/v1/analytics", { projectId: input.projectId, timeRange: input.timeRange });
  logger.info({ tool: "get_analytics_summary", organizationId: organizationIdValue }, "MCP tool call");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("list_monitors", {
  description: "List tenant-scoped health monitors and their latest status.",
  inputSchema: projectFilterInput,
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const result = await api.get("/api/v1/monitors", { projectId: input.projectId });
  logger.info({ tool: "list_monitors", organizationId: organizationIdValue }, "MCP tool call");
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

server.registerTool("list_team_members", {
  description: "List tenant-scoped team members and roles without credentials.",
  inputSchema: tenantInput,
}, async (input) => {
  const organizationIdValue = organizationId(input);
  const result = await api.get("/api/v1/team");
  logger.info({ tool: "list_team_members", organizationId: organizationIdValue }, "MCP tool call");
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

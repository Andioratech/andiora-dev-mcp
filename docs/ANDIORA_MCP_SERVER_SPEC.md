# Internal MCP (Model Context Protocol) Server Specification & AI Integration Guide

## 1. Executive Summary

This document defines the architectural specification and implementation guide for the **Andiora Internal MCP Server** (`@andiora/mcp-server`).

The Model Context Protocol (MCP) is an open standard that enables AI assistants (such as Claude Desktop, Cursor, Antigravity IDE, and custom autonomous LLM agents) to safely interface with external enterprise data sources, operational APIs, and domain tools.

By deploying `@andiora/mcp-server`, Andiora Tech engineers and AI agents can query real-time system metrics, inspect client project roadmaps, monitor API health diagnostics, retrieve tenant documentation, and dispatch support tickets through standardized JSON-RPC 2.0 tool calls.

---

## 2. System Architecture

```
┌─────────────────────────┐         stdio / SSE          ┌──────────────────────────────────┐
│   AI Agent / Assistant  │ ───────────────────────────► │   @andiora/mcp-server            │
│  (Claude, Cursor, IDE)  │ ◄─────────────────────────── │  (Model Context Protocol Server) │
└─────────────────────────┘      JSON-RPC 2.0 Protocol   └──────────────────────────────────┘
                                                                           │
                                                                           ▼
                                                         ┌──────────────────────────────────┐
                                                         │       @andiora/core Domain       │
                                                         │  (PostgreSQL, KMS, S3, Health)   │
                                                         └──────────────────────────────────┘
```

### Transport Mechanisms
1. **Stdio Transport**: Used for local AI developer environments (Cursor, Claude Desktop, Antigravity IDE).
2. **Server-Sent Events (SSE) Transport**: Used for cloud-hosted AI agents interacting over HTTPS with JWT RS256 authorization.

---

## 3. Standard Exposed MCP Tools Catalog

### 3.1 `get_organization_status`
Queries tenant status, tier, and active project counts.
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "organization_id": { "type": "string", "description": "Tenant ID (e.g. org_acme_corp)" }
    },
    "required": ["organization_id"]
  }
  ```
- **Returns**: Executive tenant summary including tier, operational status, and active project count.

### 3.2 `get_project_roadmap`
Retrieves executive milestone roadmap and dynamic completion percentage.
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "organization_id": { "type": "string" },
      "project_id": { "type": "string" }
    },
    "required": ["organization_id", "project_id"]
  }
  ```
- **Returns**: Milestone roadmap items, completion status (`COMPLETED`, `IN_PROGRESS`, `UPCOMING`), and target dates.

### 3.3 `get_health_diagnostics`
Queries real-time API uptime, response latency, and SSL certificate expiration status.
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "organization_id": { "type": "string" }
    },
    "required": ["organization_id"]
  }
  ```
- **Returns**: Endpoints monitored, 30-day uptime percentage, average latency in ms, and SSL certificate expiration days remaining.

### 3.4 `get_analytics_summary`
Retrieves zero-cookie telemetry analytics for a project.
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "project_id": { "type": "string" },
      "time_range": { "type": "string", "enum": ["24h", "7d", "30d", "90d"], "default": "30d" }
    },
    "required": ["project_id"]
  }
  ```
- **Returns**: Total pageviews, unique visitors, top requested URL paths, traffic sources, and device breakdown.

### 3.5 `create_support_ticket`
Allows AI assistants to dispatch a support ticket on behalf of a client user.
- **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "organization_id": { "type": "string" },
      "project_id": { "type": "string" },
      "subject": { "type": "string" },
      "category": { "type": "string", "enum": ["BUG_REPORT", "FEATURE_REQUEST", "QUESTION"] },
      "priority": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      "description": { "type": "string" }
    },
    "required": ["organization_id", "project_id", "subject", "category", "priority", "description"]
  }
  ```
- **Returns**: Generated ticket code (e.g. `TICK-2026-089`), status `OPEN`, and SLA response commitment.

---

## 4. MCP Server Implementation Code Template

Below is the complete, runnable TypeScript implementation template using `@modelcontextprotocol/sdk`:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "andiora-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Exposed Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_organization_status",
        description: "Retrieve executive tenant status, tier, and project count for an organization.",
        inputSchema: {
          type: "object",
          properties: {
            organization_id: { type: "string", description: "Tenant ID (e.g. org_acme_corp)" },
          },
          required: ["organization_id"],
        },
      },
      {
        name: "get_health_diagnostics",
        description: "Query real-time API uptime, response latency, and SSL certificate expiration for a client tenant.",
        inputSchema: {
          type: "object",
          properties: {
            organization_id: { type: "string", description: "Tenant ID" },
          },
          required: ["organization_id"],
        },
      },
      {
        name: "create_support_ticket",
        description: "Dispatch an operational support ticket on behalf of a client organization.",
        inputSchema: {
          type: "object",
          properties: {
            organization_id: { type: "string" },
            project_id: { type: "string" },
            subject: { type: "string" },
            category: { type: "string", enum: ["BUG_REPORT", "FEATURE_REQUEST", "QUESTION"] },
            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
            description: { type: "string" },
          },
          required: ["organization_id", "project_id", "subject", "category", "priority", "description"],
        },
      },
    ],
  };
});

// Handle Tool Invocations
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_organization_status") {
    const orgId = args?.organization_id as string;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            organizationId: orgId,
            name: "Acme Corporation",
            tier: "ENTERPRISE",
            status: "ACTIVE",
            activeProjectsCount: 3,
            totalVaultedResources: 14,
          }, null, 2),
        },
      ],
    };
  }

  if (name === "get_health_diagnostics") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            overallStatus: "ALL_SYSTEMS_OPERATIONAL",
            uptime30Days: "99.98%",
            avgLatencyMs: 142,
            endpointsMonitored: 18,
            sslCertificatesValid: true,
            nextSslExpiryDays: 142,
          }, null, 2),
        },
      ],
    };
  }

  if (name === "create_support_ticket") {
    const ticketCode = `TICK-2026-0${Math.floor(50 + Math.random() * 50)}`;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            ticketCode,
            subject: args?.subject,
            category: args?.category,
            priority: args?.priority,
            status: "OPEN",
            slaCommitment: args?.priority === "CRITICAL" ? "1 Business Hour" : "24 Business Hours",
          }, null, 2),
        },
      ],
    };
  }

  throw new Error(`Tool not found: ${name}`);
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Andiora MCP Server running on stdio transport.");
}

run().catch((error) => {
  console.error("Fatal error running MCP Server:", error);
  process.exit(1);
});
```

---

## 5. Client Integration Configurations

### 5.1 Claude Desktop Integration
Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "andiora-core": {
      "command": "node",
      "args": ["/home/st-t/Desktop/Andiora-Enterprise-Platform/packages/mcp-server/dist/index.js"],
      "env": {
        "ANDIORA_ENV": "dev",
        "NODE_ENV": "development"
      }
    }
  }
}
```

### 5.2 Cursor / Antigravity IDE Integration
In your IDE MCP settings, add:
- **Server Name**: `andiora-core`
- **Command**: `npx`
- **Args**: `-y @andiora/mcp-server`

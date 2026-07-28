# Andiora Developer MCP

Design documentation and implementation guidance for the Andiora Tech Model Context Protocol (MCP) server.

The MCP server will provide a governed interface for developer assistants to read project context, create documentation drafts, update operational reports, and retrieve tenant-scoped metrics through the Andiora platform APIs.

## Documentation

- [Internal MCP Server Specification](docs/ANDIORA_MCP_SERVER_SPEC.md)

## Engineering principles

- Reuse the Andiora API and authorization model; never connect the MCP server directly to PostgreSQL.
- Enforce tenant and project boundaries on every tool invocation.
- Keep read operations separate from write operations and require explicit confirmation for consequential actions.
- Record tool calls and mutations in an auditable event stream.
- Validate all inputs with strict schemas, apply idempotency to writes, and avoid returning secrets.
- Start with a local stdio transport for developers; add authenticated HTTPS transport only after the security controls are complete.

## Repository status

## Local development

```bash
npm install
cp .env.example .env
# Set ANDIORA_ACCESS_TOKEN in .env using a short-lived developer token.
npm run build
npm run dev
```

The first runtime phase intentionally exposes only read tools over `stdio`. It uses the existing Andiora REST API, applies a configured tenant boundary, validates inputs, redacts sensitive logs, and sends idempotency support for future write tools.

Use `list_projects` first to discover project IDs visible to the authenticated employee, then pass a selected `projectId` to `get_project_roadmap`. Project visibility and permissions remain enforced by the Andiora API.

The read-only catalog currently includes `get_organization_status`, `list_projects`, `get_project_roadmap`, `list_documents`, `list_deliverables`, `list_tickets`, `get_analytics_summary`, `get_health_diagnostics`, `list_monitors`, `list_team_members`, `list_billing_records`, and `list_vault_resources`. Vault tools return metadata only and never reveal secret values.

## Client configuration

For Cursor, Claude Desktop, or another stdio-capable client, configure the compiled entry point:

```json
{
  "mcpServers": {
    "andiora-dev": {
      "command": "node",
      "args": ["/absolute/path/to/andiora-dev-mcp/dist/index.js"],
      "env": {
        "ANDIORA_API_URL": "https://bij7hee319.execute-api.us-east-1.amazonaws.com",
        "ANDIORA_ACCESS_TOKEN": "${ANDIORA_ACCESS_TOKEN}",
        "ANDIORA_ORGANIZATION_ID": "${ANDIORA_ORGANIZATION_ID}"
      }
    }
  }
}
```

Remote Streamable HTTP, OAuth/OIDC, write tools, approval workflows, and AWS deployment remain deliberately gated for a separate security-reviewed phase. No AWS resources are created by this repository yet.

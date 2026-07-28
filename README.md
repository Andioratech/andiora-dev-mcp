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

If `ANDIORA_ACCESS_TOKEN` is empty, the MCP starts a loopback OAuth callback on
`127.0.0.1:4318`, opens the Cognito managed login in the browser, validates the
Authorization Code + PKCE response, and exchanges the Cognito identity for a
short-lived Andiora access token. The token is kept in memory only. Configure
the MCP-only Cognito issuer and public client in `.env`:

```dotenv
MCP_OIDC_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/<pool-id>
MCP_OIDC_CLIENT_ID=<public-client-id>
MCP_OIDC_SCOPES=openid email profile
MCP_OIDC_CALLBACK_PORT=4318
```

The first runtime phase intentionally exposes only read tools over `stdio`. It uses the existing Andiora REST API, applies a configured tenant boundary, validates inputs, redacts sensitive logs, and sends idempotency support for future write tools.

Use `list_projects` first to discover project IDs visible to the authenticated employee, then pass a selected `projectId` to `get_project_roadmap`. Project visibility and permissions remain enforced by the Andiora API.

The read-only catalog currently includes `get_organization_status`, `list_projects`, `get_project_roadmap`, `list_documents`, `list_deliverables`, `list_tickets`, `get_analytics_summary`, `get_health_diagnostics`, `list_monitors`, and `list_team_members`. Billing and Vault are intentionally excluded from the general developer MCP because they expose sensitive financial or infrastructure context.

The `create_markdown_document` tool uploads UTF-8 Markdown to the Andiora Document Hub as a `DRAFT`. It enforces a safe filename, a 2 MB content limit, tenant ownership, short-lived presigned S3 upload URLs, and idempotency keys. Publication remains a human-controlled platform workflow.

The workflow tools are `create_markdown_version`, `submit_document_for_review`, `approve_document`, `publish_document`, and `create_report_draft`. Versions are linked to their parent document, reports use the same sanitized Markdown pipeline, transitions are enforced by the platform, and the MCP applies a local limit of 60 API requests per minute. Structured audit logs are emitted without tokens or secrets.

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

The MCP OAuth flow is intentionally local `stdio` plus a loopback callback. It
does not expose an HTTP MCP server or persist tokens. Cognito provisioning and
the password-migration trigger are defined in the Andiora platform repository;
see its `docs/MCP_COGNITO_AUTH.md`.

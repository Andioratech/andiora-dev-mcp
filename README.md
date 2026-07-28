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

This repository currently contains the initial MCP architecture and integration specification. Runtime implementation will be added in a subsequent, separately reviewed change.

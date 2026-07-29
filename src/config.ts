import "dotenv/config";
import { z } from "zod";

// These values are public OAuth/API identifiers, not secrets. Keeping them in
// the client makes the first-run experience zero-configuration for developers.
// Environment variables remain available for private stages or overrides.
export const DEFAULT_MCP_CONFIG = {
  ANDIORA_API_URL: "https://api.andioratech.com",
  MCP_OIDC_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_nwraMiBGb",
  MCP_OIDC_CLIENT_ID: "4o0eg826db7ghk7503mbbrrsi1",
  MCP_OIDC_SCOPES: "openid email profile",
  MCP_OIDC_CALLBACK_PORT: 4318,
  MCP_HTTP_HOST: "127.0.0.1",
  MCP_HTTP_PORT: 4020,
  MCP_HTTP_PATH: "/mcp",
} as const;

const schema = z.object({
  ANDIORA_API_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().default(DEFAULT_MCP_CONFIG.ANDIORA_API_URL)).transform((value) => value.replace(/\/$/, "")),
  ANDIORA_ACCESS_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(20).optional()),
  ANDIORA_ORGANIZATION_ID: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  MCP_OIDC_ISSUER: z.preprocess((value) => value === "" ? undefined : value, z.string().url().transform((value) => value.replace(/\/$/, "")).default(DEFAULT_MCP_CONFIG.MCP_OIDC_ISSUER)),
  MCP_OIDC_CLIENT_ID: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).default(DEFAULT_MCP_CONFIG.MCP_OIDC_CLIENT_ID)),
  MCP_OIDC_SCOPES: z.preprocess((value) => value === "" ? undefined : value, z.string().default(DEFAULT_MCP_CONFIG.MCP_OIDC_SCOPES)),
  MCP_OIDC_CALLBACK_PORT: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().min(1024).max(65535).default(DEFAULT_MCP_CONFIG.MCP_OIDC_CALLBACK_PORT)),
  MCP_HTTP_HOST: z.string().min(1).default(DEFAULT_MCP_CONFIG.MCP_HTTP_HOST),
  MCP_HTTP_PORT: z.coerce.number().int().min(1024).max(65535).default(DEFAULT_MCP_CONFIG.MCP_HTTP_PORT),
  MCP_HTTP_PATH: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/).default(DEFAULT_MCP_CONFIG.MCP_HTTP_PATH),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = z.infer<typeof schema>;
export type AuthenticatedConfig = Omit<Config, "ANDIORA_ACCESS_TOKEN"> & { ANDIORA_ACCESS_TOKEN: string };

export function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid MCP configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return result.data;
}

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  ANDIORA_API_URL: z.string().url().transform((value) => value.replace(/\/$/, "")),
  ANDIORA_ACCESS_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(20).optional()),
  ANDIORA_ORGANIZATION_ID: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  MCP_OIDC_ISSUER: z.preprocess((value) => value === "" ? undefined : value, z.string().url().transform((value) => value.replace(/\/$/, "")).optional()),
  MCP_OIDC_CLIENT_ID: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  MCP_OIDC_SCOPES: z.string().default("openid email profile"),
  MCP_OIDC_CALLBACK_PORT: z.coerce.number().int().min(1024).max(65535).default(4318),
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

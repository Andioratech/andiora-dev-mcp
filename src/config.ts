import { z } from "zod";

const schema = z.object({
  ANDIORA_API_URL: z.string().url().transform((value) => value.replace(/\/$/, "")),
  ANDIORA_ACCESS_TOKEN: z.string().min(20),
  ANDIORA_ORGANIZATION_ID: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Invalid MCP configuration: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  }
  return result.data;
}

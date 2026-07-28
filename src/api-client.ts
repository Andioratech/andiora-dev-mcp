import type { AuthenticatedConfig } from "./config.js";

export class AndioraApiClient {
  private readonly requestTimes: number[] = [];
  constructor(private readonly config: AuthenticatedConfig) {}

  private enforceRateLimit(): void {
    const now = Date.now();
    while (this.requestTimes[0] && now - this.requestTimes[0] > 60_000) this.requestTimes.shift();
    if (this.requestTimes.length >= 60) throw new Error("MCP local rate limit exceeded (60 requests/minute)");
    this.requestTimes.push(now);
  }

  async get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    this.enforceRateLimit();
    const url = new URL(`${this.config.ANDIORA_API_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value) url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.ANDIORA_ACCESS_TOKEN}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    return this.parse<T>(response);
  }

  async post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    this.enforceRateLimit();
    const response = await fetch(`${this.config.ANDIORA_API_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.ANDIORA_ACCESS_TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return this.parse<T>(response);
  }

  async putPresigned(url: string, content: string): Promise<void> {
    this.enforceRateLimit();
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/markdown", "Content-Length": String(Buffer.byteLength(content, "utf8")), "x-amz-server-side-encryption": "AES256" },
      body: content,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Markdown upload failed (${response.status})`);
  }

  async put<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    this.enforceRateLimit();
    const response = await fetch(`${this.config.ANDIORA_API_URL}${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.config.ANDIORA_ACCESS_TOKEN}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    return this.parse<T>(response);
  }

  private async parse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(`Andiora API request failed (${response.status})`);
    return payload as T;
  }
}

import type { Config } from "./config.js";

export class AndioraApiClient {
  constructor(private readonly config: Config) {}

  async get<T>(path: string, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.config.ANDIORA_API_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value) url.searchParams.set(key, value);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.ANDIORA_ACCESS_TOKEN}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    return this.parse<T>(response);
  }

  async post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    const response = await fetch(`${this.config.ANDIORA_API_URL}${path}`, {
      method: "POST",
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

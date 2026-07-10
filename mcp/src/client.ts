// HTTP client for the deployed PaperTrail API.
//
// This client is the ONLY thing in the MCP server that knows how to talk to
// PaperTrail over the network. Tool handlers depend on it, never on app code.
// It unwraps the standard { success, data, error } envelope every /api route
// returns, so callers receive the typed `data` payload directly (or an Error).

const LIVE_DEFAULT_BASE_URL = "https://papertrail-topaz-phi.vercel.app";
const DEFAULT_TIMEOUT_MS = 120_000;

export interface PaperTrailClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

// The response envelope every PaperTrail /api route returns. Mirrors
// lib/api/response.ts in the main app — kept local so the MCP package imports
// no app code.
interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: { total?: number; page?: number; limit?: number };
}

// A query value passed to GET. undefined values are dropped from the query string.
type QueryValue = string | number | boolean | undefined;

export class PaperTrailClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(opts: PaperTrailClientOptions = {}) {
    const resolvedBase =
      opts.baseUrl ?? process.env.PAPERTRAIL_BASE_URL ?? LIVE_DEFAULT_BASE_URL;
    // Strip any trailing slash so path joining is predictable.
    this.baseUrl = resolvedBase.replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? process.env.PAPERTRAIL_API_KEY;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // POST a JSON body and return the unwrapped `data`. When opts.auth is true,
  // an Authorization: Bearer header is attached (and a missing key is a hard,
  // clear error).
  async post<T = unknown>(
    path: string,
    body: unknown,
    opts: { auth?: boolean } = {}
  ): Promise<T> {
    return this.request<T>("POST", path, {
      body: JSON.stringify(body ?? {}),
      auth: opts.auth ?? false,
    });
  }

  // GET with an optional query object. undefined query values are omitted.
  async get<T = unknown>(
    path: string,
    query: Record<string, QueryValue> = {},
    opts: { auth?: boolean } = {}
  ): Promise<T> {
    const qs = this.buildQuery(query);
    return this.request<T>("GET", `${path}${qs}`, {
      auth: opts.auth ?? false,
    });
  }

  private buildQuery(query: Record<string, QueryValue>): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) {
        continue;
      }
      params.append(key, String(value));
    }
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { body?: string; auth: boolean }
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };

    if (opts.auth) {
      if (!this.apiKey) {
        throw new Error(
          "This tool requires an org API key. Set PAPERTRAIL_API_KEY in the MCP server environment (Claude Science -> Connectors -> PaperTrail)."
        );
      }
      headers["authorization"] = `Bearer ${this.apiKey}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: opts.body,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `PaperTrail request to ${path} timed out after ${this.timeoutMs}ms.`
        );
      }
      throw new Error(
        `Could not reach PaperTrail at ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      clearTimeout(timer);
    }

    // Parse the body once; PaperTrail always returns JSON, but a proxy/CDN
    // error page might not, so we degrade gracefully.
    const text = await res.text();
    let envelope: ApiEnvelope<T> | null = null;
    try {
      envelope = text ? (JSON.parse(text) as ApiEnvelope<T>) : null;
    } catch {
      envelope = null;
    }

    if (!res.ok) {
      const message =
        envelope?.error ??
        `PaperTrail responded ${res.status} ${res.statusText} for ${path}.`;
      throw new Error(message);
    }

    if (!envelope) {
      throw new Error(
        `PaperTrail returned a non-JSON response for ${path} (status ${res.status}).`
      );
    }

    // Envelope routes carry a `success` key: honour failure and unwrap `data`.
    // A few routes (e.g. /api/verify, /api/stats) return RAW JSON with no
    // envelope — in that case return the parsed body as-is rather than an
    // undefined `data`.
    const hasEnvelope =
      typeof envelope === "object" &&
      envelope !== null &&
      Object.prototype.hasOwnProperty.call(envelope, "success");

    if (!hasEnvelope) {
      return envelope as unknown as T;
    }

    if (envelope.success === false) {
      throw new Error(
        envelope.error ?? `PaperTrail reported failure for ${path}.`
      );
    }

    return envelope.data as T;
  }
}

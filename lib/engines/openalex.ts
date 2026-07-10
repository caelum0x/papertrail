// Direct subprocess bridge to the pyalex-based OpenAlex search (python/openalex/
// run.py). This is a DIRECT process invocation — not an HTTP service. pyalex (MIT)
// queries the whole OpenAlex Works corpus, broadening ingestion beyond PubMed /
// ClinicalTrials.gov. It is OPT-IN (OPENALEX_ENABLED) and optional: the bridge
// NEVER throws to the caller — it rejects so the route can fall back to the
// existing TS + Claude retrieval path. Never log the caller's query text.

import { spawn } from "node:child_process";
import path from "node:path";

export interface OpenAlexWork {
  openalex_id: string | null;
  title: string | null;
  abstract: string | null;
  doi: string | null;
  year: number | null;
  cited_by_count: number | null;
  is_retracted: boolean;
}

export interface OpenAlexResult {
  ok: boolean;
  works: OpenAlexWork[];
  error?: string;
}

export interface OpenAlexInput {
  query: string;
  limit?: number;
}

const SCRIPT = path.join(process.cwd(), "python", "openalex", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DEFAULT_TIMEOUT_MS = 30_000;

/** True when OpenAlex search is enabled (opt-in via env, since it needs Python + pyalex). */
export function isOpenAlexEnabled(): boolean {
  return process.env.OPENALEX_ENABLED === "true";
}

/**
 * Search the OpenAlex Works corpus via a direct subprocess to python/openalex/run.py.
 * Resolves with the structured result on success, or rejects (the caller falls back
 * to the existing retrieval path). Never hangs: bounded by timeoutMs (SIGKILL).
 * The OPENALEX_EMAIL env var, when set, is passed through to join OpenAlex's polite
 * pool for higher rate limits. The query is written to the child's stdin — never
 * placed on argv or logged.
 */
export function searchOpenAlex(
  input: OpenAlexInput,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<OpenAlexResult> {
  return new Promise((resolve, reject) => {
    if (typeof input?.query !== "string" || input.query.trim() === "") {
      return reject(new Error("openalex: query is required"));
    }

    const email = process.env.OPENALEX_EMAIL;
    const payload = JSON.stringify({
      query: input.query,
      limit: input.limit,
      ...(email ? { email } : {}),
    });

    const proc = spawn(PYTHON_BIN, [SCRIPT]);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new Error("openalex search timed out"));
      }
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        // Prefer the structured error from stdout; fall back to a truncated stderr.
        try {
          const parsed = JSON.parse(stdout) as OpenAlexResult;
          return reject(new Error(parsed.error || `openalex exited ${code}`));
        } catch {
          return reject(new Error(`openalex exited ${code}: ${stderr.slice(0, 500)}`));
        }
      }
      try {
        const parsed = JSON.parse(stdout) as OpenAlexResult;
        if (!parsed.ok) return reject(new Error(parsed.error || "openalex reported failure"));
        if (!Array.isArray(parsed.works)) {
          return reject(new Error("openalex returned an unexpected shape"));
        }
        resolve({ ok: true, works: parsed.works });
      } catch {
        reject(new Error("failed to parse openalex output"));
      }
    });

    // Feed the query via stdin so it never appears in the process argv table.
    proc.stdin.on("error", () => {
      /* the close/error handlers above own rejection; ignore EPIPE on early exit */
    });
    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

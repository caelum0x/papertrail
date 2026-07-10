// Direct subprocess bridge to the merged MiniCheck fact-checker (python/minicheck/
// run.py). This is a DIRECT process invocation — not an HTTP service. MiniCheck (MIT)
// judges whether a claim is *entailed* (supported) by a grounding document, returning
// a 0..1 support probability. It complements lib/grounding.ts: grounding proves a quote
// is a verbatim substring of the source, MiniCheck judges whether a paraphrased claim is
// actually supported by the source text. Opt-in via MINICHECK_ENABLED, since it needs a
// Python runtime with the model weights; callers fall back to the TS+Claude path otherwise.

import { spawn } from "node:child_process";
import path from "node:path";

/** One (claim, doc) pair to fact-check. */
export interface MiniCheckPair {
  claim: string;
  doc: string;
}

export interface MiniCheckInput {
  pairs: MiniCheckPair[];
}

/** Per-pair entailment verdict from MiniCheck. */
export interface MiniCheckVerdict {
  claim: string;
  /** True when the claim is entailed (supported) by its document. */
  supported: boolean;
  /** Probability of "supported" for the decisive chunk, 0..1. */
  score: number;
}

export interface MiniCheckResult {
  ok: boolean;
  results: MiniCheckVerdict[];
  error?: string;
}

const SCRIPT = path.join(process.cwd(), "python", "minicheck", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DEFAULT_TIMEOUT_MS = 120_000;

/** True when MiniCheck fact-checking is enabled (opt-in via env, needs Python + model). */
export function isMiniCheckEnabled(): boolean {
  return process.env.MINICHECK_ENABLED === "true";
}

/**
 * Fact-check (claim, doc) pairs via a direct subprocess to the merged MiniCheck engine.
 * Resolves with the structured result, or REJECTS so the caller can fall back to the
 * existing TS+Claude verification path. Never throws to the route; never hangs (bounded
 * by timeoutMs, SIGKILL on timeout). Claim/doc text is passed only over the child's stdin
 * pipe — never logged here.
 */
export function factCheck(input: MiniCheckInput, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MiniCheckResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [SCRIPT]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("minicheck fact-check timed out"));
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`minicheck exited ${code}: ${stderr.slice(0, 500)}`));
      }
      try {
        const parsed = JSON.parse(stdout) as MiniCheckResult;
        if (!parsed.ok) return reject(new Error(parsed.error || "minicheck reported failure"));
        if (!Array.isArray(parsed.results)) return reject(new Error("minicheck returned no results array"));
        resolve(parsed);
      } catch {
        reject(new Error("failed to parse minicheck output"));
      }
    });

    // Pairs go over stdin, never argv, to avoid leaking claim/doc text into the process table.
    proc.stdin.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.stdin.write(JSON.stringify({ pairs: input.pairs }));
    proc.stdin.end();
  });
}

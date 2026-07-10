// Direct subprocess bridge to the merged PyMARE meta-analysis backend
// (python/pymare/run.py). This is a DIRECT process invocation — not an HTTP
// service. PyMARE (MIT, neurostuff) is used as an INDEPENDENT reference
// cross-check of PaperTrail's in-process TS oracle (lib/metaAnalysis.ts): a
// second, battle-tested implementation of the same fixed-effect + DerSimonian-
// Laird closed forms. When enabled and available, a divergence between the two
// pooled estimates flags a bug in either side; when unavailable, the caller
// simply keeps the TS result (graceful fallback, like Docling).
//
// This bridge NEVER throws to the route — it rejects, so the caller can fall
// back to the existing TS path.

import { spawn } from "node:child_process";
import path from "node:path";

/** One pooled summary (fixed or random effects) on the analysis scale of yi. */
export interface PyMarePooled {
  estimate: number;
  se: number;
  ciLower: number;
  ciUpper: number;
}

/** Random-effects summary additionally reports the between-study variance tau^2. */
export interface PyMareRandomPooled extends PyMarePooled {
  tau2: number;
}

/** Study-level effects (yi) and their sampling variances (vi), same length. */
export interface PyMareInput {
  yi: number[];
  vi: number[];
}

/** Successful cross-check result mirrored from run.py's JSON contract. */
export interface PyMareResult {
  ok: true;
  fixed: PyMarePooled;
  random: PyMareRandomPooled;
  q: number; // Cochran's Q
  i2: number; // I^2 heterogeneity (0..100)
}

const SCRIPT = path.join(process.cwd(), "python", "pymare", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DEFAULT_TIMEOUT_MS = 30_000;

/** True when the PyMARE cross-check is enabled (opt-in via env; needs Python). */
export function isPyMareEnabled(): boolean {
  return process.env.PYMARE_ENABLED === "true";
}

function isPooled(value: unknown): value is PyMarePooled {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.estimate === "number" &&
    typeof v.se === "number" &&
    typeof v.ciLower === "number" &&
    typeof v.ciUpper === "number"
  );
}

function parseResult(stdout: string): PyMareResult {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  if (parsed.ok !== true) {
    throw new Error(typeof parsed.error === "string" ? parsed.error : "pymare reported failure");
  }
  const { fixed, random, q, i2 } = parsed;
  if (
    !isPooled(fixed) ||
    !isPooled(random) ||
    typeof (random as unknown as Record<string, unknown>).tau2 !== "number" ||
    typeof q !== "number" ||
    typeof i2 !== "number"
  ) {
    throw new Error("pymare returned an unexpected result shape");
  }
  return { ok: true, fixed, random: random as unknown as PyMareRandomPooled, q, i2 };
}

/**
 * Pool study-level effects via the merged PyMARE backend as an independent
 * cross-check. Resolves with the structured result, or rejects (the caller keeps
 * the TS oracle result). Never hangs: bounded by timeoutMs (SIGKILL). Never logs
 * the input values.
 */
export function pooledPyMARE(
  input: PyMareInput,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PyMareResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [SCRIPT]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("pymare cross-check timed out"));
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      // On any exit code, run.py prints a single JSON object. Prefer its
      // structured {ok:false,error} message; fall back to the exit code +
      // stderr (a traceback, never the numeric inputs) if stdout is unusable.
      try {
        resolve(parseResult(stdout));
      } catch (err) {
        if (code !== 0 && !stdout.trim()) {
          return reject(new Error(`pymare exited ${code}: ${stderr.slice(0, 300)}`));
        }
        reject(err instanceof Error ? err : new Error("failed to parse pymare output"));
      }
    });

    // Feed the payload on stdin, then close it so run.py can read to EOF.
    proc.stdin.write(JSON.stringify({ yi: input.yi, vi: input.vi }));
    proc.stdin.end();
  });
}

// Direct subprocess bridge to the merged ASReview active-learning ranker
// (python/asreview/run.py). This is a DIRECT process invocation — not an HTTP service.
// ASReview (Apache-2.0) is the systematic-review screening engine; given a handful of
// human relevant/irrelevant decisions it trains an active learner (TF-IDF + NaiveBayes)
// and re-ranks the remaining candidates most-relevant-first. We call it when a Python
// runtime with ASReview installed is available (opt-in), and the caller falls back to
// the existing TS + Claude ranking path otherwise.
//
// The bridge NEVER throws to the route: it rejects, so the caller can catch and fall
// back. It is bounded by a timeout (SIGKILL) and never logs record text.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/** A candidate record to be screened. */
export interface AsreviewRecord {
  id: string | number;
  title: string;
  abstract: string;
}

/** A human screening decision: 1 = relevant, 0 = irrelevant. */
export interface AsreviewLabel {
  id: string | number;
  label: 0 | 1;
}

export interface AsreviewInput {
  records: AsreviewRecord[];
  labeled: AsreviewLabel[];
}

/** One ranked unlabeled record; higher relevance = more likely relevant. */
export interface AsreviewRankedRecord {
  id: string | number;
  relevance: number;
}

export interface AsreviewResult {
  ok: boolean;
  ranking: AsreviewRankedRecord[];
  error?: string;
}

// Minimal shape of the spawn we depend on — just the single call form this bridge
// uses (`spawn(bin, args)`). Lets tests inject a fake without mocking node:child_process
// globally, while the real spawn (which is a superset of this) is used in production.
type SpawnFn = (command: string, args: readonly string[]) => ChildProcess;

const SCRIPT = path.join(process.cwd(), "python", "asreview", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DEFAULT_TIMEOUT_MS = 60_000;

/** True when the ASReview ranker is enabled (opt-in via env, since it needs Python + ASReview). */
export function isAsreviewEnabled(): boolean {
  return process.env.ASREVIEW_ENABLED === "true";
}

/**
 * Rank the unlabeled records via the merged ASReview active learner, as a direct
 * subprocess. Resolves with the ranking (most-relevant-first), or rejects so the
 * caller falls back to the TS + Claude path. Never hangs: bounded by `timeoutMs`.
 *
 * `spawnFn` is injectable for testing; production uses node:child_process spawn.
 */
export function rankRecords(
  input: AsreviewInput,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnFn: SpawnFn = nodeSpawn,
): Promise<AsreviewResult> {
  return new Promise((resolve, reject) => {
    const proc = spawnFn(PYTHON_BIN, [SCRIPT]);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(() => reject(new Error("asreview ranking timed out")));
    }, timeoutMs);

    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("error", (err) => finish(() => reject(err)));
    proc.on("close", (code) => {
      // run.py emits a JSON envelope even on a handled error (exit 1). Prefer its
      // structured error to an opaque exit code so the caller gets a real reason.
      let parsed: AsreviewResult | null = null;
      try {
        parsed = JSON.parse(stdout) as AsreviewResult;
      } catch {
        parsed = null;
      }

      if (parsed && parsed.ok) {
        return finish(() => resolve(parsed as AsreviewResult));
      }
      if (parsed && !parsed.ok) {
        return finish(() => reject(new Error(parsed!.error || "asreview reported failure")));
      }
      if (code !== 0) {
        return finish(() =>
          reject(new Error(`asreview exited ${code}: ${stderr.slice(0, 500)}`)),
        );
      }
      finish(() => reject(new Error("failed to parse asreview output")));
    });

    // Feed the job as JSON on stdin, then close it so run.py can read to EOF.
    try {
      proc.stdin?.write(JSON.stringify(input));
      proc.stdin?.end();
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

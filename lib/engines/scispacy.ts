// Direct subprocess bridge to the merged scispaCy biomedical entity linker
// (python/scispacy/run.py). This is a DIRECT process invocation — not an HTTP service.
// scispaCy (Apache-2.0, AllenAI) does biomedical NER and links each mention to a
// UMLS/MeSH concept (CUI + canonical name). It complements PaperTrail's PubTator path
// as a high-precision, offline entity linker; we call it when a Python runtime with
// scispacy + a biomedical model is available (opt-in via SCISPACY_ENABLED), and the
// caller falls back to the existing entity-normalization path otherwise.
//
// This bridge NEVER throws to the caller: it rejects, so callers can catch and fall
// back. It is bounded by a timeout (SIGKILL) and never logs the input text.

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/** One biomedical entity mention linked to a UMLS/MeSH concept (nullable when unlinked). */
export interface ScispacyEntity {
  /** The exact mention substring from the input text. */
  text: string;
  /** The NER label assigned by the scispaCy model (e.g. "ENTITY"). */
  label: string;
  /** Character offset of the mention start in the input text. */
  start: number;
  /** Character offset of the mention end (exclusive) in the input text. */
  end: number;
  /** Linked UMLS CUI (or MeSH id), or null when no candidate cleared the threshold. */
  umlsCui: string | null;
  /** Canonical concept name from the knowledge base, or null when unlinked. */
  canonicalName: string | null;
  /** Linker similarity score for the top candidate, or null when unlinked. */
  score: number | null;
}

export interface ScispacyResult {
  ok: boolean;
  entities: ScispacyEntity[];
  error?: string;
}

// Minimal shape of the spawn we depend on — just the single call form this bridge
// uses (`spawn(bin, args)`). Lets tests inject a fake without mocking node:child_process
// globally, while the real spawn (a superset of this) is used in production.
type SpawnFn = (command: string, args: readonly string[]) => ChildProcess;

const SCRIPT = path.join(process.cwd(), "python", "scispacy", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DEFAULT_TIMEOUT_MS = 120_000;

/** True when the scispaCy linker is enabled (opt-in via env, since it needs Python + a model). */
export function isScispacyEnabled(): boolean {
  return process.env.SCISPACY_ENABLED === "true";
}

/**
 * Link biomedical entities in `text` to UMLS/MeSH concepts via the merged scispaCy
 * pipeline, as a direct subprocess. Resolves with the linked entities, or rejects so
 * the caller falls back to the existing entity-normalization path. Never hangs:
 * bounded by `timeoutMs` (SIGKILL). Never logs the input text.
 *
 * `spawnFn` is injectable for testing; production uses node:child_process spawn.
 */
export function linkEntities(
  text: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnFn: SpawnFn = nodeSpawn,
): Promise<ScispacyResult> {
  return new Promise((resolve, reject) => {
    if (!text || !text.trim()) {
      reject(new Error("scispacy: text is required"));
      return;
    }

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
      finish(() => reject(new Error("scispacy linking timed out")));
    }, timeoutMs);

    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("error", (err) => finish(() => reject(err)));
    proc.on("close", (code) => {
      // run.py emits a JSON envelope even on a handled error (exit 1). Prefer its
      // structured error to an opaque exit code so the caller gets a real reason.
      let parsed: ScispacyResult | null = null;
      try {
        parsed = JSON.parse(stdout) as ScispacyResult;
      } catch {
        parsed = null;
      }

      if (parsed && parsed.ok) {
        return finish(() => resolve(parsed as ScispacyResult));
      }
      if (parsed && !parsed.ok) {
        return finish(() => reject(new Error(parsed!.error || "scispacy reported failure")));
      }
      if (code !== 0) {
        return finish(() =>
          reject(new Error(`scispacy exited ${code}: ${stderr.slice(0, 500)}`)),
        );
      }
      finish(() => reject(new Error("failed to parse scispacy output")));
    });

    // Feed the text as a JSON job on stdin (never argv), then close it so run.py
    // can read to EOF.
    try {
      proc.stdin?.write(JSON.stringify({ text }));
      proc.stdin?.end();
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

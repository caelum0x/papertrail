// Direct subprocess bridge to the merged STORM synthesizer (python/storm/run.py).
// This is a DIRECT process invocation — not an HTTP service. STORM (knowledge-storm,
// Stanford OVAL, MIT) researches a topic and writes a long, Wikipedia-style article
// with inline citations; PaperTrail points it at its own pre-vetted cached sources so
// the synthesis stays inside PaperTrail's evidence boundary. It is PaperTrail's long-form
// cited-synthesis backend, complementing the shorter TS+Claude verification path.
//
// Opt-in via STORM_ENABLED, since it needs a Python runtime with knowledge-storm and an
// Anthropic key; callers fall back to the existing TS+Claude synthesis otherwise. The
// bridge NEVER throws to the route — it REJECTS so the caller can choose the fallback.
// Topic/source text is passed only over the child's stdin pipe — never logged here.

import { spawn } from "node:child_process";
import path from "node:path";

/** A pre-vetted PaperTrail source handed to STORM as grounding for the synthesis. */
export interface StormSource {
  title?: string;
  url?: string;
  /** Full source text; used as a snippet when `snippets` is omitted. */
  text?: string;
  snippets?: string[];
  description?: string;
}

export interface StormInput {
  topic: string;
  sources?: StormSource[];
}

/** One inline reference from the generated article. */
export interface StormCitation {
  title: string;
  url: string;
}

export interface StormResult {
  ok: boolean;
  /** Section/subsection names in pre-order. */
  outline: string[];
  /** Full article text with inline [n] citation markers. */
  article: string;
  citations: StormCitation[];
  error?: string;
}

const SCRIPT = path.join(process.cwd(), "python", "storm", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
// STORM runs a multi-stage LM pipeline (research + outline + article + polish); give it room.
const DEFAULT_TIMEOUT_MS = 300_000;

/** True when STORM synthesis is enabled (opt-in via env, needs Python + knowledge-storm + Anthropic key). */
export function isStormEnabled(): boolean {
  return process.env.STORM_ENABLED === "true";
}

/**
 * Generate a long-form, cited article via a direct subprocess to the merged STORM engine.
 * Resolves with the structured result, or REJECTS so the caller can fall back to the
 * existing TS+Claude synthesis path. Never throws to the route; never hangs (bounded by
 * timeoutMs, SIGKILL on timeout). Topic/source text is passed only over stdin, never argv.
 */
export function generateStormArticle(
  input: StormInput,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<StormResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [SCRIPT]);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("storm synthesis timed out"));
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
        return reject(new Error(`storm exited ${code}: ${stderr.slice(0, 500)}`));
      }
      try {
        const parsed = JSON.parse(stdout) as StormResult;
        if (!parsed.ok) return reject(new Error(parsed.error || "storm reported failure"));
        if (!Array.isArray(parsed.outline)) return reject(new Error("storm returned no outline array"));
        if (typeof parsed.article !== "string") return reject(new Error("storm returned no article string"));
        if (!Array.isArray(parsed.citations)) return reject(new Error("storm returned no citations array"));
        resolve(parsed);
      } catch {
        reject(new Error("failed to parse storm output"));
      }
    });

    // Topic + sources go over stdin, never argv, to avoid leaking text into the process table.
    proc.stdin.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.stdin.write(JSON.stringify({ topic: input.topic, sources: input.sources ?? [] }));
    proc.stdin.end();
  });
}

// Direct subprocess bridge to the vendored PyKEEN link-prediction backend
// (python/pykeen/run.py). This is a DIRECT process invocation — not an HTTP
// service. PyKEEN (MIT) trains a small knowledge-graph embedding model on a set of
// (head, relation, tail) triples and scores plausible NOVEL triples — i.e. drug
// repurposing / novel-association hypotheses over PaperTrail's evidence graph. We
// call it when a Python runtime with pykeen installed is available (opt-in via
// PYKEEN_ENABLED); callers fall back to their own heuristics otherwise.
//
// The ranked links this returns are HYPOTHESES to verify against real sources, never
// ground truth — the score only orders which novel links are worth investigating.
//
// This module NEVER throws to the caller: it rejects, so the caller can catch and
// fall back. It never logs the triples or the prediction target.

import { spawn } from "node:child_process";
import path from "node:path";

/** A scored (head, relation, tail) triple. For the predicted slot the value is the
 *  candidate label; the two fixed slots echo the request. */
export interface PyKeenPrediction {
  head: string;
  relation: string;
  tail: string;
  /** The model's plausibility score (higher = more plausible); ranking only, not a probability. */
  score: number;
}

export interface PyKeenResult {
  ok: boolean;
  /** The KGE model that was trained (e.g. "TransE"). */
  model: string;
  /** How many epochs were actually run (already bounded by the Python side). */
  epochs: number;
  /** Which slot was predicted: "head" | "relation" | "tail". */
  target: string;
  /** Ranked candidate triples, highest score first. */
  predictions: PyKeenPrediction[];
  error?: string;
}

/** The prediction target: exactly one of head/relation/tail must be omitted/undefined
 *  (that is the slot to predict); the other two are fixed. */
export interface PyKeenPredictTarget {
  head?: string;
  relation?: string;
  tail?: string;
}

export interface PyKeenInput {
  /** The evidence graph as label-based triples: [head, relation, tail][]. */
  triples: Array<[string, string, string]>;
  /** Which slot to predict (leave exactly one of head/relation/tail undefined). */
  predict: PyKeenPredictTarget;
  /** Optional tuning passed straight to the pipeline. */
  model?: string;
  epochs?: number;
  topK?: number;
  dimensions?: number;
  randomSeed?: number;
}

const SCRIPT = path.join(process.cwd(), "python", "pykeen", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
// Training, even a tiny model, is heavier than a single LLM call — give it room.
const DEFAULT_TIMEOUT_MS = 300_000;

/** True when the PyKEEN backend is enabled (opt-in: needs Python + pykeen + torch). */
export function isPyKeenEnabled(): boolean {
  return process.env.PYKEEN_ENABLED === "true";
}

/** Map the camelCase TS input to the snake_case JSON the Python script expects. */
function toPayload(input: PyKeenInput): Record<string, unknown> {
  return {
    triples: input.triples,
    predict: {
      head: input.predict.head,
      relation: input.predict.relation,
      tail: input.predict.tail,
    },
    model: input.model,
    epochs: input.epochs,
    top_k: input.topK,
    dimensions: input.dimensions,
    random_seed: input.randomSeed,
  };
}

/** Exactly one of head/relation/tail must be left undefined (the slot to predict). */
function fixedSlotCount(predict: PyKeenPredictTarget): number {
  return [predict.head, predict.relation, predict.tail].filter((v) => v !== undefined && v !== null).length;
}

/**
 * Train a small KGE model on the provided triples and score the requested prediction
 * target via a direct subprocess. Resolves with the ranked predictions, or rejects
 * (the caller falls back). Never hangs: bounded by timeoutMs (SIGKILL).
 */
export function predictLinks(input: PyKeenInput, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PyKeenResult> {
  return new Promise((resolve, reject) => {
    if (!isPyKeenEnabled()) {
      reject(new Error("pykeen disabled"));
      return;
    }
    if (!Array.isArray(input.triples) || input.triples.length === 0) {
      reject(new Error("pykeen: a non-empty triples list is required"));
      return;
    }
    if (!input.predict || fixedSlotCount(input.predict) !== 2) {
      reject(new Error("pykeen: predict must fix exactly two of head/relation/tail (leave one to predict)"));
      return;
    }

    const proc = spawn(PYTHON_BIN, [SCRIPT]);
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
      finish(() => reject(new Error("pykeen prediction timed out")));
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => finish(() => reject(err)));
    proc.on("close", (code) => {
      finish(() => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`pykeen exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        let parsed: PyKeenResult;
        try {
          parsed = JSON.parse(stdout) as PyKeenResult;
        } catch {
          reject(new Error("failed to parse pykeen output"));
          return;
        }
        if (!parsed.ok) {
          reject(new Error(parsed.error || "pykeen reported failure"));
          return;
        }
        resolve(parsed);
      });
    });

    // Feed the request over stdin as a single JSON object, then close the pipe.
    // Triples / prediction target never go on argv, so they never leak into the
    // process table.
    proc.stdin.on("error", (err) => finish(() => reject(err)));
    proc.stdin.write(JSON.stringify(toPayload(input)));
    proc.stdin.end();
  });
}

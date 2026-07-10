// Direct subprocess bridge to the vendored FutureHouse PaperQA2 backend
// (python/paperqa/run.py). This is a DIRECT process invocation — not an HTTP
// service. PaperQA2 (Apache-2.0) is an agentic paper-QA engine that retrieves
// evidence passages and summarizes an answer grounded in them; we call it when a
// Python runtime with paper-qa installed is available (opt-in via PAPERQA_ENABLED),
// and the caller falls back to the in-process TS + Claude path otherwise.
//
// This module NEVER throws to the route: it rejects, so the caller can catch and
// fall back. It never logs the question or source text.

import { spawn } from "node:child_process";
import path from "node:path";

/** One retrieved evidence passage backing the answer. */
export interface PaperQaContext {
  /** The exact retrieved passage text (for grounding back to the source). */
  text: string;
  /** Chunk name, e.g. "NCT001 chunk 2". */
  name: string;
  /** PaperQA relevance score, 0-10 (-1 when unset). */
  score: number;
  /** PaperQA's per-context summary with respect to the question. */
  summary: string;
}

export interface PaperQaResult {
  ok: boolean;
  /** The synthesized answer text. */
  answer: string;
  /** Retrieved passages the answer is grounded in. */
  contexts: PaperQaContext[];
  /** Formatted bibliography / references block. */
  references: string;
  error?: string;
}

/** One source document to index (already-fetched text, not a live fetch). */
export interface PaperQaSource {
  name: string;
  text: string;
}

export interface PaperQaInput {
  question: string;
  texts: PaperQaSource[];
  /** Optional model / retrieval tuning passed straight to paper-qa Settings. */
  llm?: string;
  summaryLlm?: string;
  embedding?: string;
  temperature?: number;
  answerMaxSources?: number;
  evidenceK?: number;
}

const SCRIPT = path.join(process.cwd(), "python", "paperqa", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DEFAULT_TIMEOUT_MS = 180_000;

/** True when the PaperQA2 backend is enabled (opt-in: needs Python + paper-qa + an LLM key). */
export function isPaperQaEnabled(): boolean {
  return process.env.PAPERQA_ENABLED === "true";
}

/** Map the camelCase TS input to the snake_case JSON the Python script expects. */
function toPayload(input: PaperQaInput): Record<string, unknown> {
  return {
    question: input.question,
    texts: input.texts,
    llm: input.llm,
    summary_llm: input.summaryLlm,
    embedding: input.embedding,
    temperature: input.temperature,
    answer_max_sources: input.answerMaxSources,
    evidence_k: input.evidenceK,
  };
}

/**
 * Run the PaperQA2 backend on the provided question + source texts via a direct
 * subprocess. Resolves with the structured result, or rejects (the caller falls
 * back to the TS + Claude path). Never hangs: bounded by timeoutMs (SIGKILL).
 */
export function askPaperQa(input: PaperQaInput, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PaperQaResult> {
  return new Promise((resolve, reject) => {
    if (!isPaperQaEnabled()) {
      reject(new Error("paperqa disabled"));
      return;
    }
    if (!input.question || !Array.isArray(input.texts) || input.texts.length === 0) {
      reject(new Error("paperqa: question and non-empty texts are required"));
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
      finish(() => reject(new Error("paperqa query timed out")));
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => finish(() => reject(err)));
    proc.on("close", (code) => {
      finish(() => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`paperqa exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        let parsed: PaperQaResult;
        try {
          parsed = JSON.parse(stdout) as PaperQaResult;
        } catch {
          reject(new Error("failed to parse paperqa output"));
          return;
        }
        if (!parsed.ok) {
          reject(new Error(parsed.error || "paperqa reported failure"));
          return;
        }
        resolve(parsed);
      });
    });

    // Feed the request over stdin as a single JSON object, then close the pipe.
    proc.stdin.on("error", (err) => finish(() => reject(err)));
    proc.stdin.write(JSON.stringify(toPayload(input)));
    proc.stdin.end();
  });
}

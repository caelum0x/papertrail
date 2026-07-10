// Direct subprocess bridge to the cloned INDRA mechanism-assembly backend
// (python/indra/run.py). This is a DIRECT process invocation — not an HTTP
// service. INDRA (Sorger/Gyori Lab, BSD-2) assembles mechanistic causal
// statements (Agent A activates / inhibits / phosphorylates B) with a belief
// score and evidence provenance, from free-text or from a curated pathway
// source (Pathway Commons). We call it when a Python runtime with `indra`
// installed is available (opt-in via INDRA_ENABLED), and the caller falls back
// to its in-process path otherwise.
//
// This module NEVER throws to the route: it rejects, so the caller can catch and
// fall back. It never logs the claim text or source text.

import { spawn } from "node:child_process";
import path from "node:path";

/** One piece of evidence backing an assembled mechanistic statement. */
export interface IndraEvidence {
  /** The reader / database that produced this evidence (e.g. "reach"). */
  source: string | null;
  /** The exact source sentence the statement was extracted from (for grounding). */
  text: string | null;
  /** PubMed ID the evidence came from, when known. */
  pmid: string | null;
}

/** One assembled mechanistic causal statement: subj --type--> obj. */
export interface IndraStatement {
  /** INDRA statement type, e.g. "Activation", "Inhibition", "Phosphorylation". */
  type: string;
  /** Causal subject agent name (e.g. "BRAF"), or null if unbound. */
  subj: string | null;
  /** Causal object agent name (e.g. "MAP2K1"), or null if unbound. */
  obj: string | null;
  /** INDRA belief score in [0, 1], or null when unset. */
  belief: number | null;
  /** Provenance for the statement — never an unsourced claim. */
  evidence: IndraEvidence[];
}

export interface IndraResult {
  ok: boolean;
  /** The reader/source that produced the statements ("reach" | "pathway_commons"). */
  reader: string;
  /** The assembled mechanistic statements. */
  statements: IndraStatement[];
  error?: string;
}

export interface IndraInput {
  /** Natural-language text to read for mechanisms (takes priority over genes). */
  text?: string;
  /** HGNC gene symbols to query a curated pathway source for. */
  genes?: string[];
  /** PMID attached to text-reader evidence. */
  citation?: string;
  /** Seconds to wait on the reader web request. */
  timeout?: number;
  /** Pathway-query depth for the genes path. */
  neighborLimit?: number;
  /** Cap on the number of statements returned. */
  maxStatements?: number;
}

const SCRIPT = path.join(process.cwd(), "python", "indra", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DEFAULT_TIMEOUT_MS = 180_000;

/** True when the INDRA backend is enabled (opt-in: needs Python + indra installed). */
export function isIndraEnabled(): boolean {
  return process.env.INDRA_ENABLED === "true";
}

/** Map the camelCase TS input to the snake_case JSON the Python script expects. */
function toPayload(input: IndraInput): Record<string, unknown> {
  return {
    text: input.text,
    genes: input.genes,
    citation: input.citation,
    timeout: input.timeout,
    neighbor_limit: input.neighborLimit,
    max_statements: input.maxStatements,
  };
}

/**
 * Assemble mechanistic causal statements from text or a gene set via a direct
 * subprocess to INDRA. Resolves with the structured result, or rejects (the caller
 * falls back). Never hangs: bounded by timeoutMs (SIGKILL).
 */
export function assembleMechanisms(input: IndraInput, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<IndraResult> {
  return new Promise((resolve, reject) => {
    if (!isIndraEnabled()) {
      reject(new Error("indra disabled"));
      return;
    }
    const hasText = typeof input.text === "string" && input.text.trim().length > 0;
    const hasGenes = Array.isArray(input.genes) && input.genes.length > 0;
    if (!hasText && !hasGenes) {
      reject(new Error("indra: non-empty 'text' or 'genes' is required"));
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
      finish(() => reject(new Error("indra assembly timed out")));
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => finish(() => reject(err)));
    proc.on("close", (code) => {
      finish(() => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`indra exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        let parsed: IndraResult;
        try {
          parsed = JSON.parse(stdout) as IndraResult;
        } catch {
          reject(new Error("failed to parse indra output"));
          return;
        }
        if (!parsed.ok) {
          reject(new Error(parsed.error || "indra reported failure"));
          return;
        }
        resolve(parsed);
      });
    });

    // Feed the request over stdin as a single JSON object, then close the pipe —
    // claim text never goes into argv (it would leak into the process table).
    proc.stdin.on("error", (err) => finish(() => reject(err)));
    proc.stdin.write(JSON.stringify(toPayload(input)));
    proc.stdin.end();
  });
}

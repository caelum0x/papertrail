// Direct subprocess bridge to the vendored pytrials ClinicalTrials.gov client
// (python/pytrials/run.py). This is a DIRECT process invocation — not an HTTP
// service. pytrials (MIT) wraps the ClinicalTrials.gov v2 API; we call it to fetch
// a structured trial landscape (nctId, status, phase, conditions, interventions,
// enrollment) for a drug/condition query when a Python runtime with pytrials
// installed is available (opt-in via PYTRIALS_ENABLED), and the caller falls back
// to its own path otherwise.
//
// This module NEVER throws to the route: it rejects, so the caller can catch and
// fall back. It never logs the query text.

import { spawn } from "node:child_process";
import path from "node:path";

/** One digested trial-landscape row from ClinicalTrials.gov. */
export interface TrialStudy {
  /** ClinicalTrials.gov identifier, e.g. "NCT01234567" (null if absent). */
  nctId: string | null;
  /** Brief (or official) study title. */
  title: string | null;
  /** Overall recruitment status, e.g. "COMPLETED", "RECRUITING". */
  status: string | null;
  /** Trial phase, e.g. "PHASE3" (joined by "/" when multiple), or null. */
  phase: string | null;
  /** Studied conditions/diseases. */
  conditions: string[];
  /** Intervention names (drugs, procedures, etc.). */
  interventions: string[];
  /** Planned/actual enrollment count, or null when unspecified. */
  enrollment: number | null;
}

export interface PyTrialsResult {
  ok: boolean;
  /** Number of studies returned. */
  count: number;
  /** The digested trial landscape. */
  studies: TrialStudy[];
  error?: string;
}

export interface PyTrialsInput {
  /** ClinicalTrials.gov search expression, e.g. "semaglutide cardiovascular". */
  query: string;
  /** Optional field hints (accepted for API symmetry; does not change output). */
  fields?: string[];
  /** Max studies to return, 1..1000 (default 20). */
  max?: number;
}

const SCRIPT = path.join(process.cwd(), "python", "pytrials", "run.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DEFAULT_TIMEOUT_MS = 60_000;

/** True when the pytrials backend is enabled (opt-in: needs Python + pytrials + network). */
export function isPyTrialsEnabled(): boolean {
  return process.env.PYTRIALS_ENABLED === "true";
}

/** Map the TS input to the JSON the Python script expects over stdin. */
function toPayload(input: PyTrialsInput): Record<string, unknown> {
  return {
    query: input.query,
    fields: input.fields,
    max: input.max,
  };
}

/**
 * Query ClinicalTrials.gov for a trial landscape via a direct subprocess. Resolves
 * with the structured result, or rejects (the caller falls back). Never hangs:
 * bounded by timeoutMs (SIGKILL). Never throws to the caller.
 */
export function searchTrials(input: PyTrialsInput, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PyTrialsResult> {
  return new Promise((resolve, reject) => {
    if (!isPyTrialsEnabled()) {
      reject(new Error("pytrials disabled"));
      return;
    }
    if (!input.query || typeof input.query !== "string" || !input.query.trim()) {
      reject(new Error("pytrials: a non-empty query is required"));
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
      finish(() => reject(new Error("pytrials query timed out")));
    }, timeoutMs);

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => finish(() => reject(err)));
    proc.on("close", (code) => {
      finish(() => {
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`pytrials exited ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        let parsed: PyTrialsResult;
        try {
          parsed = JSON.parse(stdout) as PyTrialsResult;
        } catch {
          reject(new Error("failed to parse pytrials output"));
          return;
        }
        if (!parsed.ok) {
          reject(new Error(parsed.error || "pytrials reported failure"));
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

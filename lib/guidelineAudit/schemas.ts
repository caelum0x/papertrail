import { z } from "zod";

// GUIDELINE / PRESS-RELEASE AUDIT — Zod schemas.
//
// Stage 1 is the heavy-Claude step: Claude reads a whole document (a clinical
// guideline, a press release, a review paper's abstract) and extracts EVERY discrete
// efficacy claim it makes, each as a standalone verifiable statement. That output is
// untrusted LLM JSON, so it MUST be validated against `ExtractedClaimSchema` before we
// do anything with it (CLAUDE.md: never trust raw JSON.parse of an LLM response).
//
// Stage 2 (verification) is deterministic and lives in audit.ts; its per-claim result
// shape is described here too so the route and UI share one contract.

// The exact sentence (or short clause) in the source document that Claude believes
// makes this efficacy claim. It MUST be a verbatim substring of the pasted text so we
// can ground it back to an exact character span via lib/grounding.ts. Claude is asked
// to quote it exactly; grounding is what makes that a code invariant, not a promise.
export const ExtractedClaimSchema = z.object({
  // A single, self-contained, verifiable restatement of the efficacy claim — resolved
  // of pronouns and cross-references so it can be fed to the verification pipeline on
  // its own (e.g. "Drug X reduced major cardiovascular events by 30%").
  statement: z
    .string()
    .trim()
    .min(10)
    .max(600)
    .describe("A standalone, verifiable restatement of one efficacy claim."),
  // The verbatim sentence from the document that this claim was drawn from — used for
  // exact-span grounding. Verbatim so it can be located in the source text.
  sourceSentence: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe("The exact sentence from the pasted document making this claim."),
  // What is being claimed to work, in the document's own terms (drug/intervention).
  intervention: z
    .string()
    .trim()
    .max(300)
    .describe("The intervention/drug the claim is about."),
});
export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

// The top-level shape Claude must return for Stage 1. A document that makes no
// efficacy claims is a valid, expected result (empty array) — not an error.
export const ClaimExtractionSchema = z.object({
  claims: z.array(ExtractedClaimSchema).max(40),
});
export type ClaimExtraction = z.infer<typeof ClaimExtractionSchema>;

// Per-claim verdict from Stage 2. Deterministic — derived from the verification
// pipeline's evidence report, never from an LLM.
export const AuditVerdict = z.enum([
  "accurate", // the primary evidence supports the claim as stated
  "overstated", // the claim overstates what the primary evidence shows
  "unsupported", // no confident primary source could be found to verify the claim
  "uncertain", // sources were found but the evidence is too weak/thin to rule on
]);
export type AuditVerdict = z.infer<typeof AuditVerdict>;

// A pooled/primary finding surfaced next to the claim, in plain terms, so the UI can
// show "what the source actually found" beside "what the document claimed". Null when
// nothing poolable was found.
export interface AuditedPooledFinding {
  measure: string; // "HR" | "RR" | "OR"
  point: number; // pooled random-effects ratio estimate
  ciLower: number;
  ciUpper: number;
  studies: number; // how many primary sources contributed
  summary: string; // one-line human summary
}

// One fully-audited claim: the extracted statement, its grounded source span, the
// deterministic verdict + trust score, and the primary-source finding it was judged
// against.
export interface AuditedClaim {
  text: string;
  intervention: string;
  // The exact source sentence and its character offsets in the pasted document, or
  // null if the sentence could not be grounded (in which case the claim is dropped
  // upstream — an ungrounded claim is an unsourced claim, and we never make one).
  groundedSpan: {
    text: string;
    start: number;
    end: number;
    status: "exact" | "approximate";
  };
  verdict: AuditVerdict;
  trustScore: number; // 0-100
  explanation: string;
  pooledFinding: AuditedPooledFinding | null;
}

export interface GuidelineAuditSummary {
  total: number;
  overstated: number;
  unsupported: number;
  accurate: number;
}

export interface GuidelineAuditResult {
  claims: AuditedClaim[];
  summary: GuidelineAuditSummary;
}

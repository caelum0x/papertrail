import { z } from "zod";

// Zod schemas for the multi-step fact-verification pipeline ported from Loki /
// OpenFactVerification (decompose -> checkworthy -> query-gen -> retrieve ->
// verify -> aggregate). Every LLM structured output is validated against one of
// these before it is used — never trust a raw JSON.parse of a model response.

// --- Route input -------------------------------------------------------------

// Public request body: a block of natural-language text to fact-check. Bounded
// so a single request can't drive an unbounded decompose/verify fan-out.
export const FactCheckRequestSchema = z.object({
  text: z.string().trim().min(1, "text is required").max(4000, "text is too long"),
});
export type FactCheckRequest = z.infer<typeof FactCheckRequestSchema>;

// --- Step 1: decompose (Claude) ---------------------------------------------

// Loki's decompose_prompt returns {"claims": [ ... ]}. We keep the atomic-claim
// contract but bound the count so one paragraph can't explode into dozens of
// per-claim verify chains.
export const DecomposeResultSchema = z.object({
  claims: z.array(z.string().trim().min(1)).min(1).max(20),
});
export type DecomposeResult = z.infer<typeof DecomposeResultSchema>;

// --- Step 2: checkworthiness (Claude) ---------------------------------------

// Loki emits, per claim, a "Yes (...)" / "No (...)" verdict. We port that to an
// explicit boolean + reason so downstream code never string-parses "Yes"/"No".
export const CheckworthyItemSchema = z.object({
  claim: z.string().trim().min(1),
  checkworthy: z.boolean(),
  reason: z.string().trim().min(1),
});
export const CheckworthyResultSchema = z.object({
  items: z.array(CheckworthyItemSchema).min(1),
});
export type CheckworthyItem = z.infer<typeof CheckworthyItemSchema>;
export type CheckworthyResult = z.infer<typeof CheckworthyResultSchema>;

// --- Step 3: query generation (Claude) --------------------------------------

// Loki's qgen_prompt returns {"Questions": [ ... ]}. Bounded per claim.
export const QueryGenResultSchema = z.object({
  queries: z.array(z.string().trim().min(1)).max(5),
});
export type QueryGenResult = z.infer<typeof QueryGenResultSchema>;

// --- Step 5: per-evidence verification (Claude) ------------------------------

// Loki's verify_prompt returns reasoning/error/correction/factuality against a
// single evidence. We port the label to an explicit relationship enum grounded
// to a quoted source span, matching PaperTrail's grounding invariant.
export const EvidenceRelationship = z.enum(["supported", "refuted", "unverified"]);
export type EvidenceRelationship = z.infer<typeof EvidenceRelationship>;

export const VerifyEvidenceResultSchema = z.object({
  relationship: EvidenceRelationship,
  reasoning: z.string().trim().min(1),
  // The exact substring of the retrieved source that supports/refutes the claim.
  // Grounded (located in raw_text) before it is trusted; "unverified" may omit it.
  source_span: z.string().default(""),
});
export type VerifyEvidenceResult = z.infer<typeof VerifyEvidenceResultSchema>;

// --- Pipeline output shape (returned by the route) --------------------------

export const PER_CLAIM_VERDICT = z.enum([
  "supported",
  "refuted",
  "unverified",
  "not_checkworthy",
]);
export type PerClaimVerdict = z.infer<typeof PER_CLAIM_VERDICT>;

// One piece of grounded evidence attached to a claim's verdict.
export const GroundedEvidenceSchema = z.object({
  source_id: z.string(),
  source_type: z.enum(["pubmed", "clinicaltrials"]),
  external_id: z.string(),
  title: z.string().nullable(),
  url: z.string(),
  relationship: EvidenceRelationship,
  reasoning: z.string(),
  // Verbatim substring of the source raw_text (grounded) + char offsets, or null
  // when the model produced no locatable span (dropped by the grounding step).
  source_span: z.string().nullable(),
  span_start: z.number().int().nullable(),
  span_end: z.number().int().nullable(),
});
export type GroundedEvidence = z.infer<typeof GroundedEvidenceSchema>;

export const ClaimResultSchema = z.object({
  claim: z.string(),
  checkworthy: z.boolean(),
  checkworthy_reason: z.string(),
  queries: z.array(z.string()),
  verdict: PER_CLAIM_VERDICT,
  // Per-claim factuality: supported / (supported + refuted) over grounded
  // evidence, or null when nothing checkable/verifiable was found.
  factuality: z.number().min(0).max(1).nullable(),
  evidence: z.array(GroundedEvidenceSchema),
  // How many model-produced spans were dropped for being ungroundable.
  grounding_dropped_count: z.number().int().min(0),
});
export type ClaimResult = z.infer<typeof ClaimResultSchema>;

export const FactCheckSummarySchema = z.object({
  num_claims: z.number().int().min(0),
  num_checkworthy: z.number().int().min(0),
  num_verified: z.number().int().min(0),
  num_supported: z.number().int().min(0),
  num_refuted: z.number().int().min(0),
  num_controversial: z.number().int().min(0),
  // Overall factuality: mean of per-claim factuality over verified claims, or
  // null when no claim could be verified against our cached sources.
  factuality: z.number().min(0).max(1).nullable(),
});
export type FactCheckSummary = z.infer<typeof FactCheckSummarySchema>;

export const FactCheckOutputSchema = z.object({
  claims: z.array(ClaimResultSchema),
  summary: FactCheckSummarySchema,
});
export type FactCheckOutput = z.infer<typeof FactCheckOutputSchema>;

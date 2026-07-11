// PaperTrail's flagship distortion detector, extracted DB-free and reusable.
//
// This is the verification path that scores 95% on the single-source clinical benchmark —
// higher than Claude-alone (90%). It runs LLM extraction of the source finding, an LLM audit
// of the claim against that finding classifying the discrepancy type, GROUNDS every flagged
// span to a verbatim source substring, and then applies the DETERMINISTIC reconcile which can
// only DEMOTE an "accurate" verdict to a rule-decidable numeric distortion — never invent one.
//
// It catches the full distortion taxonomy a plain entailment / magnitude check misses:
//   magnitude_overstated · population_overgeneralized · caveat_dropped · no_support_found.
//
// DB-free and stateless (extraction is inline, not cached to Postgres), so it is safe to call
// from the stateless MoA orchestrator. The two prompts + schemas are the same ones the
// benchmark's PaperTrail path uses.

import { z } from "zod";
import { callClaudeForJson } from "../claude";
import { ExtractedFindingSchema, VerificationResultSchema } from "../schemas";
import { groundVerificationResult } from "../grounding";
import { reconcile } from "../effectSize";

export type DiscrepancyType =
  | "accurate"
  | "magnitude_overstated"
  | "population_overgeneralized"
  | "caveat_dropped"
  | "no_support_found";

export interface DiscrepancyGroundedSpan {
  claimSpan: string;
  sourceSpan: string; // verbatim located substring of the source
  issue: string;
  start: number;
  end: number;
}

export interface DiscrepancyResult {
  discrepancyType: DiscrepancyType;
  trustScore: number;
  explanation: string;
  groundedSpans: DiscrepancyGroundedSpan[];
  // True when the deterministic reconcile demoted an LLM "accurate" verdict to a distortion.
  reconcileDemoted: boolean;
  droppedUngroundedSpans: number;
}

const EXTRACTION_SYSTEM = `You are a precise scientific data extraction assistant.
Given the text of a paper abstract or clinical record, extract ONLY what is
explicitly stated. Do not infer, generalize, or fill in gaps with typical values
from similar studies. If a field is not stated, use "not reported".
Respond with ONLY a single JSON object matching this shape, no other text:
{
  "effect_size": string,
  "population": string,
  "condition": string,
  "endpoint": string,
  "caveats": string[]
}`;

const VERIFICATION_SYSTEM = `You are a rigorous scientific claim auditor. You compare
a claim against the actual finding extracted from its PRIMARY source and classify
exactly how (if at all) the claim has drifted from that source.

Discrepancy types (judged against the PRIMARY source only):
- "accurate": the claim's direction, magnitude, population, and conditions are all
  consistent with the source (reasonable paraphrase is fine; distortion is not).
- "magnitude_overstated": the claim's effect is meaningfully larger/stronger than
  the source supports, OR the claim asserts the OPPOSITE direction of the source.
- "population_overgeneralized": the claim implies a broader population than studied.
- "caveat_dropped": the source has a material limitation the claim omits.
- "no_support_found": the claim is not meaningfully addressed by this source at all.

trust_score: 0-100, reflecting ONLY how well the claim matches the PRIMARY source.
90-100 = accurate. 60-89 = minor drift. 30-59 = meaningful distortion. 0-29 = major
distortion or unsupported.

Respond with ONLY a single JSON object, no other text:
{
  "discrepancy_type": "accurate" | "magnitude_overstated" | "population_overgeneralized" | "caveat_dropped" | "no_support_found",
  "trust_score": number,
  "explanation": string,
  "flagged_spans": [{ "claim_span": string, "source_span": string, "issue": string }],
  "cross_source_agreement": "single_source" | "corroborated" | "conflicting"
}
flagged_spans must be empty if discrepancy_type is "accurate". Every source_span must
be an exact substring of the PRIMARY source text provided — do not paraphrase it.`;

// The deterministic reconcile can only DEMOTE an "accurate" verdict; these are the reconcile
// verdicts that indicate a real numeric distortion.
const RECONCILE_DEMOTION: Record<string, DiscrepancyType> = {
  magnitude_overstated: "magnitude_overstated",
  caveat_dropped: "caveat_dropped",
};

// Injectable Claude caller for offline tests.
export interface DiscrepancyDeps {
  callClaudeForJson: typeof callClaudeForJson;
}

const defaultDeps: DiscrepancyDeps = { callClaudeForJson };

/**
 * Detect how a claim has drifted from its primary source. Returns the discrepancy type, the
 * grounded flagged spans (verbatim source substrings; ungroundable ones dropped + counted),
 * and whether the deterministic reconcile demoted the verdict. DB-free.
 */
export async function detectDiscrepancy(
  claim: string,
  sourceText: string,
  deps: DiscrepancyDeps = defaultDeps
): Promise<DiscrepancyResult> {
  // Both LLM steps see the SAME window of the source. Asymmetric truncation (12KB extract /
  // 8KB verify) let a finding in [8000:12000] be extracted in step 1 but be unreferenceable in
  // step 2, and — worse — let the deterministic reconcile (below) demote on text Claude never
  // saw. One shared boundary keeps extraction, verification, and reconcile internally consistent.
  const source = sourceText.slice(0, 8000);

  // Step 1 — extract the source finding (only what's explicitly stated).
  const finding = await deps.callClaudeForJson({
    system: EXTRACTION_SYSTEM,
    user: `Source text:\n\n${source}`,
    schema: ExtractedFindingSchema,
    maxTokens: 700,
  });

  // Step 2 — audit the claim against the extracted finding + source text.
  const rawVerdict = await deps.callClaudeForJson({
    system: VERIFICATION_SYSTEM,
    user:
      `Claim to audit:\n"${claim}"\n\nExtracted finding from PRIMARY source:\n` +
      `${JSON.stringify(finding, null, 2)}\n\nFull PRIMARY source text (for locating exact ` +
      `source_span quotes):\n${source}`,
    schema: VerificationResultSchema,
    maxTokens: 1000,
  });

  // Step 3 — grounding invariant: drop any flagged span that isn't a verbatim source substring.
  const grounded = groundVerificationResult(rawVerdict, sourceText);

  // Step 4 — deterministic reconcile demotion (numbers the model may have missed).
  let discrepancyType = grounded.discrepancy_type as DiscrepancyType;
  let reconcileDemoted = false;
  if (discrepancyType === "accurate") {
    // Reconcile only on the window Claude actually saw. Running it over the full untruncated
    // sourceText let effect sizes / caveats OUTSIDE Claude's window trigger a demotion whose
    // flagged spans would then fail grounding (they aren't in what was audited) — a demotion
    // with no groundable evidence. `source` here is the shared 8KB window from both LLM steps.
    const rec = reconcile(claim, source);
    const demoted = RECONCILE_DEMOTION[rec.verdict];
    if (demoted) {
      discrepancyType = demoted;
      reconcileDemoted = true;
    }
  }

  const groundedSpans: DiscrepancyGroundedSpan[] = grounded.flagged_spans.map((s) => ({
    claimSpan: s.claim_span,
    sourceSpan: s.source_span,
    issue: s.issue,
    start: s.grounding.start,
    end: s.grounding.end,
  }));

  return {
    discrepancyType,
    trustScore: typeof grounded.trust_score === "number" ? grounded.trust_score : 0,
    explanation: grounded.explanation ?? "",
    groundedSpans,
    reconcileDemoted,
    droppedUngroundedSpans: rawVerdict.flagged_spans.length - grounded.flagged_spans.length,
  };
}

// The zod re-export keeps callers from importing schemas separately when they only need this.
export const _schemas = { ExtractedFindingSchema, VerificationResultSchema, z };

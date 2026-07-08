import { callClaudeForJson } from "../claude";
import { CrossSourceAgreement, ExtractedFinding, VerificationResultSchema } from "../schemas";
import { GroundedVerificationResult, groundVerificationResult } from "../grounding";

const SYSTEM_PROMPT = `You are a rigorous scientific claim auditor. You compare
a public-facing claim against the actual finding extracted from its PRIMARY
source, and classify exactly how (if at all) the claim has drifted from that
source. You are ALSO shown findings from other independent sources that were
retrieved for the same claim, and you judge whether they corroborate or conflict
with the primary source.

Discrepancy types (judged against the PRIMARY source only):
- "accurate": the claim's direction, magnitude, population, and conditions are
  all consistent with the source (reasonable paraphrase is fine; distortion is not).
- "magnitude_overstated": the claim's effect size is meaningfully larger/stronger
  than the source supports.
- "population_overgeneralized": the claim implies a broader population than the
  source studied (e.g. source studied a specific subgroup, claim implies "all patients").
- "caveat_dropped": the source has a material limitation/qualification that the
  claim omits, changing how the claim should be interpreted.
- "no_support_found": the claim is not meaningfully addressed by this source at all.

trust_score: 0-100, reflecting ONLY how well the claim matches the PRIMARY source.
90-100 = accurate. 60-89 = minor drift. 30-59 = meaningful distortion. 0-29 = major
distortion or unsupported. Do NOT adjust this score for the other sources — score the
primary match on its own; agreement is captured separately below.

cross_source_agreement (about the OTHER sources vs the primary):
- "single_source": no other sources were provided.
- "corroborated": the other sources report findings consistent with the primary
  (same direction/effect for the same intervention and outcome).
- "conflicting": at least one other source reports a materially different or opposite
  finding for the same intervention/outcome.

Respond with ONLY a single JSON object, no other text:
{
  "discrepancy_type": "accurate" | "magnitude_overstated" | "population_overgeneralized" | "caveat_dropped" | "no_support_found",
  "trust_score": number,
  "explanation": string,
  "flagged_spans": [{ "claim_span": string, "source_span": string, "issue": string }],
  "cross_source_agreement": "single_source" | "corroborated" | "conflicting"
}
flagged_spans must be empty if discrepancy_type is "accurate". Every source_span
must be an exact substring of the PRIMARY source text provided - do not paraphrase it.`;

// Deterministic, explainable trust-score deltas for cross-source agreement. A claim
// corroborated by independent studies is more trustworthy than the same claim resting
// on one source; conflicting sources lower trust even when the primary looks accurate.
const CORROBORATION_BONUS = 8;
const CONFLICT_PENALTY = 20;

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function adjustTrustScore(base: number, agreement: CrossSourceAgreement): number {
  if (agreement === "corroborated") return clampScore(base + CORROBORATION_BONUS);
  if (agreement === "conflicting") return clampScore(base - CONFLICT_PENALTY);
  return clampScore(base);
}

export async function verifyClaim(params: {
  claim: string;
  finding: ExtractedFinding;
  sourceRawText: string;
  /** Findings extracted from the OTHER retrieved sources, used to judge agreement. */
  otherFindings?: ExtractedFinding[];
}): Promise<GroundedVerificationResult> {
  const otherFindings = params.otherFindings ?? [];

  const otherSection =
    otherFindings.length > 0
      ? `\n\nFindings from ${otherFindings.length} OTHER independent source(s) retrieved for this claim:\n${JSON.stringify(
          otherFindings,
          null,
          2
        )}`
      : "\n\nNo other sources were retrieved (single_source).";

  const user = `Claim to audit:
"${params.claim}"

Extracted finding from PRIMARY source:
${JSON.stringify(params.finding, null, 2)}${otherSection}

Full PRIMARY source text (for locating exact source_span quotes):
${params.sourceRawText.slice(0, 8000)}`;

  const raw = await callClaudeForJson({
    system: SYSTEM_PROMPT,
    user,
    schema: VerificationResultSchema,
    maxTokens: 1000,
  });

  // With no other sources there is nothing to corroborate — force single_source
  // rather than trusting the model to notice, then apply the deterministic delta.
  const agreement: CrossSourceAgreement =
    otherFindings.length === 0 ? "single_source" : raw.cross_source_agreement;

  const adjusted = {
    ...raw,
    cross_source_agreement: agreement,
    trust_score: adjustTrustScore(raw.trust_score, agreement),
  };

  // Enforce PaperTrail's core trust invariant in CODE, not just in the prompt:
  // every surviving flagged span is a verbatim substring of the source. Any span
  // the model couldn't (or didn't) quote exactly is dropped here — see lib/grounding.ts.
  return groundVerificationResult(adjusted, params.sourceRawText);
}

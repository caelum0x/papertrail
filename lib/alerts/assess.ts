// Claude-assessed evidence alerts (Trialstreamer-style). Given a WATCHED TOPIC, that
// topic's CURRENT pooled verdict (optional), and a CANDIDATE new source, Claude READS
// the source and assesses whether it MATTERS:
//   (1) is the source relevant to the watched topic, and
//   (2) would it CONFIRM, WEAKEN, OVERTURN, or leave unchanged (NONE) the current verdict?
//
// This is genuine Claude reasoning over the source's natural language — judging whether
// a new trial's effect direction/magnitude/population reinforces or undercuts an existing
// pooled conclusion. Regex/keyword matching cannot decide impact.
//
// The deterministic TRUST LAYER then grounds the model's supporting quote back to the
// source text with lib/grounding.ts. If the quote isn't a real substring of the source,
// we DROP the assessment (status "ungroundable") rather than assert an impact reason we
// can't point to. callClaudeForJson + Zod means we never trust raw JSON from the model.

import { CLAUDE_MODEL, callClaudeForJson } from "../claude";
import { locateSpan } from "../grounding";
import {
  AlertAssessmentSchema,
  type AlertAssessment,
  type AlertAssessOutcome,
  type GroundedAlertAssessment,
} from "./schemas";

const SYSTEM = `You are an evidence-surveillance analyst. You watch a research topic and, when a NEW source appears, you assess whether it MATTERS to that topic's current conclusion.

You are given:
- WATCHED_TOPIC: the clinical/research question being watched (e.g. "Does drug X reduce major cardiovascular events?").
- CURRENT_VERDICT: the topic's current pooled conclusion so far, or "(none yet)" if there is no established verdict.
- SOURCE_TEXT: the abstract / registered finding of a newly appearing source.

Assess two things:

1. RELEVANCE — is SOURCE_TEXT actually about WATCHED_TOPIC (same intervention/population/outcome family)? Set "relevant" to "relevant" or "not_relevant".

2. IMPACT — GIVEN CURRENT_VERDICT, how would this source move it? Set "likely_impact":
   - "confirms": the source's result points the SAME direction as CURRENT_VERDICT and reinforces it.
   - "weakens": the source's result is null, smaller, or in tension with CURRENT_VERDICT without fully reversing it.
   - "overturns": the source's result contradicts CURRENT_VERDICT in a way that would change the conclusion (e.g. opposite direction, or a large well-powered null against a positive verdict).
   - "none": not relevant, or adds no material information to the verdict.
   If CURRENT_VERDICT is "(none yet)", judge impact as the effect this source would have on a body of evidence starting from it — usually "confirms" if it shows a clear effect, "none" if inconclusive.

Rules:
- Base every judgment ONLY on SOURCE_TEXT's wording, not on outside knowledge of the drug or field.
- Extract "evidence_quote" as an EXACT, verbatim sentence copied character-for-character from SOURCE_TEXT — the single sentence that best supports your relevance/impact call. Do NOT paraphrase, merge sentences, or add ellipses.
- If SOURCE_TEXT is not relevant, set "likely_impact" to "none" and quote the sentence that shows it's off-topic.
- "confidence" is your calibrated confidence in the IMPACT call (0-1).

Respond with ONLY a JSON object:
{"relevant":"...","relevance_reason":"...","likely_impact":"...","impact_reason":"...","evidence_quote":"...","confidence":0.0}`;

export interface AssessAlertInput {
  topic: string;
  currentVerdict?: string | null;
  sourceText: string;
  sourceTitle?: string | null;
}

function buildUser(input: AssessAlertInput): string {
  const verdict =
    input.currentVerdict && input.currentVerdict.trim().length > 0
      ? input.currentVerdict.trim()
      : "(none yet)";
  const titleLine =
    input.sourceTitle && input.sourceTitle.trim().length > 0
      ? `SOURCE_TITLE:\n${input.sourceTitle.trim()}\n\n`
      : "";
  return [
    `WATCHED_TOPIC:\n${input.topic}`,
    "",
    `CURRENT_VERDICT:\n${verdict}`,
    "",
    `${titleLine}SOURCE_TEXT:\n${input.sourceText}`,
    "",
    "Assess whether this source is relevant to the watched topic and how it would move the current verdict, quoting the exact supporting sentence from SOURCE_TEXT.",
  ].join("\n");
}

/**
 * Assess a candidate new source against a watched topic and ground the supporting
 * quote.
 *
 * Returns a discriminated outcome. When the model's evidence quote can be located
 * verbatim in the source, `status: "assessed"` carries the grounded assessment
 * (verbatim quote + offsets). When it cannot be located, `status: "ungroundable"` —
 * we refuse to assert an impact reason we can't point to in the source.
 *
 * Throws only on infrastructure/validation failure (no Claude JSON, schema mismatch);
 * the caller maps that to a user-safe error.
 */
export async function assessAlert(input: AssessAlertInput): Promise<AlertAssessOutcome> {
  const raw = await callClaudeForJson({
    system: SYSTEM,
    user: buildUser(input),
    schema: AlertAssessmentSchema,
    maxTokens: 700,
  });

  return groundAlertAssessment(input.sourceText, raw);
}

/**
 * Pure trust-layer step: ground the model's evidence quote against the source text.
 * Kept separate from the Claude call so it can be tested with no network/LLM.
 * Returns a NEW outcome object; inputs are not mutated.
 */
export function groundAlertAssessment(
  sourceText: string,
  assessment: AlertAssessment
): AlertAssessOutcome {
  const located = locateSpan(sourceText, assessment.evidence_quote);
  if (!located) {
    return {
      status: "ungroundable",
      message:
        "Claude assessed this source, but its supporting quote could not be located verbatim in the source text, so the assessment was withheld. Paste the source's exact abstract/finding and try again.",
    };
  }

  const grounded: GroundedAlertAssessment = {
    relevant: assessment.relevant,
    relevance_reason: assessment.relevance_reason,
    likely_impact: assessment.likely_impact,
    impact_reason: assessment.impact_reason,
    // The VERBATIM located substring, never the model's copy.
    evidence_quote: located.text,
    confidence: assessment.confidence,
    grounding: { status: located.status, start: located.start, end: located.end },
  };

  return { status: "assessed", assessment: grounded };
}

export { CLAUDE_MODEL };

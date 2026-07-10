// Smart-citation stance classification (Scite-style). Given a CITING passage and
// the CITED work's claim/finding, Claude reasons about the citation SEMANTICS —
// does the citing text present the cited finding as SUPPORTING, CONTRASTING, or
// merely MENTIONING it — and extracts the exact citation-context sentence.
//
// This is genuine Claude reasoning over natural language, not a lookup: the stance
// often turns on hedging, contrast markers ("however", "in contrast", "failed to
// replicate"), and whether the cited result is used as evidence FOR the citing
// claim or set against it. Regex cannot do this reliably.
//
// The deterministic TRUST LAYER then grounds the model's context sentence back to
// the citing text with lib/grounding.ts. If the sentence isn't a real substring of
// the citing passage, we DROP the classification (status "ungroundable") rather
// than assert a stance quote we can't point to. callClaudeForJson + Zod means we
// never trust raw JSON from the model.

import { CLAUDE_MODEL, callClaudeForJson } from "../claude";
import { locateSpan } from "../grounding";
import {
  CitationClassificationSchema,
  type CitationClassifyOutcome,
  type GroundedCitationClassification,
} from "./schemas";

const SYSTEM = `You are a citation-intelligence analyst. You classify HOW a citing passage cites another work's finding, in the style of "smart citations".

You are given:
- CITING_TEXT: a passage from a paper that cites another work.
- CITED_CLAIM: the finding/claim of the work being cited.

Classify the STANCE the citing passage takes toward the cited claim:
- "supporting": the citing text uses the cited finding as evidence FOR its own point, agrees with it, replicates it, or builds on it as established.
- "contrasting": the citing text disagrees with, contradicts, fails to replicate, questions, or sets its own result AGAINST the cited finding.
- "mentioning": the citing text refers to the cited work neutrally (background, methods, "see also") without endorsing or disputing the finding.

Rules:
- Base the stance ONLY on the CITING_TEXT's wording, not on your own view of who is correct.
- Extract "context_sentence" as an EXACT, verbatim sentence copied character-for-character from CITING_TEXT — the single sentence that best expresses the stance. Do not paraphrase, merge sentences, or add ellipses.
- If the passage is ambiguous or purely descriptive, prefer "mentioning".
- "confidence" is your calibrated confidence in the stance (0-1).

Respond with ONLY a JSON object:
{"stance": "...", "context_sentence": "...", "reasoning": "...", "confidence": 0.0}`;

function buildUser(citingText: string, citedClaim: string): string {
  return [
    "CITED_CLAIM:",
    citedClaim,
    "",
    "CITING_TEXT:",
    citingText,
    "",
    "Classify the stance the CITING_TEXT takes toward CITED_CLAIM and quote the exact context sentence.",
  ].join("\n");
}

export interface ClassifyCitationInput {
  citing_text: string;
  cited_claim: string;
}

/**
 * Classify a citation's stance and ground its context sentence.
 *
 * Returns a discriminated outcome. When the model's context sentence can be located
 * verbatim in the citing text, `status: "classified"` carries the grounded result
 * (verbatim sentence + offsets). When it cannot be located, `status: "ungroundable"`
 * — we refuse to assert a stance quote we can't point to in the source.
 *
 * Throws only on infrastructure/validation failure (no Claude JSON, schema mismatch);
 * the caller maps that to a user-safe error.
 */
export async function classifyCitation(
  input: ClassifyCitationInput
): Promise<CitationClassifyOutcome> {
  const raw = await callClaudeForJson({
    system: SYSTEM,
    user: buildUser(input.citing_text, input.cited_claim),
    schema: CitationClassificationSchema,
    maxTokens: 512,
  });

  return groundCitationClassification(input.citing_text, raw);
}

/**
 * Pure trust-layer step: ground the model's context sentence against the citing
 * text. Kept separate from the Claude call so it can be tested with no network/LLM.
 * Returns a NEW outcome object; inputs are not mutated.
 */
export function groundCitationClassification(
  citingText: string,
  classification: {
    stance: GroundedCitationClassification["stance"];
    context_sentence: string;
    reasoning: string;
    confidence: number;
  }
): CitationClassifyOutcome {
  const located = locateSpan(citingText, classification.context_sentence);
  if (!located) {
    return {
      status: "ungroundable",
      message:
        "The stance was assessed, but its supporting sentence could not be located verbatim in the citing text, so it was withheld. Paste the exact citing passage and try again.",
    };
  }

  const grounded: GroundedCitationClassification = {
    stance: classification.stance,
    // The VERBATIM located substring, never the model's copy.
    context_sentence: located.text,
    reasoning: classification.reasoning,
    confidence: classification.confidence,
    grounding: { status: located.status, start: located.start, end: located.end },
  };

  return { status: "classified", classification: grounded };
}

export { CLAUDE_MODEL };

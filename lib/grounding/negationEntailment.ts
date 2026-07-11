import { z } from "zod";
import { callClaudeForJson } from "../claude";
import { locateSpan, type SpanGroundingStatus } from "../grounding";

// PAPERTRAIL-NATIVE NEGATION-AWARE ENTAILMENT — the native TypeScript specialization of the
// MiniCheck engine (backend/engines/MiniCheck/papertrail_negation.py; see that dir's
// PAPERTRAIL.md for the field-for-field mapping).
//
// MiniCheck (Tang, Laban & Durrett, EMNLP 2024) answers exactly one question with a trained
// model: MiniCheck(document, claim) -> supported | unsupported, where "supported" means "all
// information in the claim is substantiated by the document" (see lib/grounding/entailment.ts,
// our port of that step). That framing has a blind spot PaperTrail must not have: ABSENCE
// claims. "Drug X does NOT cause hepatotoxicity" is SUPPORTED by a source showing ABSENCE
// ("no significant difference in ALT elevation vs placebo") and REFUTED by a source showing
// PRESENCE ("Drug X caused dose-dependent hepatotoxicity"). A vanilla consistency check
// conflates the two: the polarity of the claim flips the meaning of every support signal.
//
// MOAT: NO LLM decides polarity, the numeric score, or the final label. Polarity is decided
// deterministically from a negation-cue lexicon; the final label is a FIXED
// (polarity x source_assertion) table. The ONLY model step is the polarity-NEUTRAL judgement
// "does the source assert the PRESENCE of this effect, its ABSENCE, or NEITHER?" — reusing the
// exact entailment.ts pattern (Claude returns a verbatim supporting sentence) — and that
// judgement only counts once its supporting sentence is GROUNDED in the source via
// lib/grounding.locateSpan. An ungroundable supporting sentence is DROPPED and the verdict
// falls back to `nei`: PaperTrail never asserts an unsourced span, and honest-insufficient
// beats a forced answer.
//
// LABEL TABLE (polarity x what the source asserts about the effect):
//
//                    | source: presence | source: absence     | source: neither
//   -----------------+------------------+---------------------+----------------
//   positive claim   | supported        | refuted             | nei
//   negative claim   | refuted          | negative_supported  | nei
//
// `negative_supported` is a DISTINCT verdict (not folded into `supported`) so downstream
// consumers see that an ABSENCE claim was confirmed by evidence of ABSENCE — the honest
// provenance of the answer.

/** Claim polarity, decided deterministically from the negation-cue lexicon. */
export type ClaimPolarity = "positive" | "negative";

/** What the source asserts about the claimed effect — the neutral, grounded model judgement. */
export type SourceAssertion = "presence" | "absence" | "neither";

/** Final absence-aware verdict. */
export type AbsenceLabel = "supported" | "negative_supported" | "refuted" | "nei";

// ---------------------------------------------------------------------------
// NEGATION-CUE LEXICON — IDENTICAL to NEGATION_CUES in papertrail_negation.py. Matched
// case-insensitively as whole tokens (word boundaries), so "notable" does not trip "not".
// ---------------------------------------------------------------------------
export const NEGATION_CUES: readonly string[] = [
  "not",
  "no",
  "never",
  "none",
  "without",
  "absence of",
  "lack of",
  "lacks",
  "lacking",
  "fails to",
  "failed to",
  "does not",
  "do not",
  "did not",
  "cannot",
  "unable to",
  "no evidence of",
  "no association",
  "not associated",
  "no significant",
  "did not cause",
  "does not cause",
  "no increased risk",
  "not linked",
] as const;

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministically classify a claim's polarity from the negation-cue lexicon. A claim is
 * NEGATIVE when it denies the effect it names. Whole-token matching (JS `\b`-style boundaries
 * via lookarounds on word chars) so substrings like "notable" never false-trip. Mirrors
 * detect_polarity() in papertrail_negation.py — same cues, same rule, same result.
 */
export function detectPolarity(claim: string): { polarity: ClaimPolarity; cues: string[] } {
  const lowered = claim.toLowerCase();
  const cues: string[] = [];
  for (const cue of NEGATION_CUES) {
    const pattern = new RegExp(`(?<!\\w)${escapeRegExp(cue)}(?!\\w)`);
    if (pattern.test(lowered)) {
      cues.push(cue);
    }
  }
  return { polarity: cues.length > 0 ? "negative" : "positive", cues };
}

// ---------------------------------------------------------------------------
// LABEL MAPPING — the FIXED (polarity x source_assertion) -> label table above. No model
// touches this. Mirrors _LABEL_TABLE / map_label() in papertrail_negation.py.
// ---------------------------------------------------------------------------
const LABEL_TABLE: Record<ClaimPolarity, Record<SourceAssertion, AbsenceLabel>> = {
  positive: { presence: "supported", absence: "refuted", neither: "nei" },
  negative: { presence: "refuted", absence: "negative_supported", neither: "nei" },
};

/** Map (claim polarity, what the source asserts) -> final label by the fixed table. */
export function mapLabel(polarity: ClaimPolarity, assertion: SourceAssertion): AbsenceLabel {
  return LABEL_TABLE[polarity][assertion];
}

// ---------------------------------------------------------------------------
// THE MODEL STEP — the neutral, polarity-agnostic judgement. Reuses entailment.ts's pattern:
// Claude returns a structured verdict PLUS the single verbatim supporting sentence we then
// ground. It NEVER sees the claim's polarity and NEVER emits a final label — it only reports
// what the source asserts about the effect.
// ---------------------------------------------------------------------------

const AssertionJudgementSchema = z.object({
  source_assertion: z
    .enum(["presence", "absence", "neither"])
    .describe(
      "Does the document assert the PRESENCE of the effect the claim is about, its ABSENCE " +
        "(no effect / no association / no significant difference), or NEITHER (not addressed)?"
    ),
  confidence: z.number().min(0).max(1).describe("Model confidence in the judgement, 0-1."),
  supporting_sentence: z
    .string()
    .describe(
      "For presence or absence, the single sentence quoted VERBATIM from the document that " +
        "shows it. Empty string when neither."
    ),
});
export type AssertionJudgement = z.infer<typeof AssertionJudgementSchema>;

// The effect the claim is about, stated neutrally so the model judges presence/absence
// WITHOUT knowing the claim's polarity (the polarity lives only in the deterministic layer).
const SYSTEM_PROMPT =
  "You assess what a scientific document asserts about a specific EFFECT or ASSOCIATION. " +
  "Given the document and the effect in question, decide whether the document asserts the " +
  "PRESENCE of that effect, its ABSENCE (explicit no effect, no association, or no " +
  "significant difference), or NEITHER (the document does not address it). Do NOT judge " +
  "whether any claim is true — only report what the document asserts about the effect. When " +
  "the answer is presence or absence, quote the single supporting sentence from the document " +
  "VERBATIM and character-for-character; do not paraphrase or invent it. Respond only with " +
  "the JSON object.";

function buildUserPrompt(effect: string, document: string): string {
  return (
    `Document:\n${document}\n\nEffect in question:\n${effect}\n\n` +
    'Respond with JSON: {"source_assertion": "presence" | "absence" | "neither", ' +
    '"confidence": number 0-1, "supporting_sentence": string (verbatim document sentence ' +
    'for presence/absence, else "")}'
  );
}

/** Injectable Claude call so offline tests never touch the network or an API key. */
export interface NegationEntailmentDeps {
  callClaudeForJson: typeof callClaudeForJson;
}

const defaultDeps: NegationEntailmentDeps = { callClaudeForJson };

// ---------------------------------------------------------------------------
// RESULT — mirrors the output object of papertrail_negation.py verify_absence_claim().
// ---------------------------------------------------------------------------

export interface AbsenceSupportingSpan {
  /** The verbatim source substring we located (never the model's paraphrase). */
  text: string;
  grounding: { status: SpanGroundingStatus; start: number; end: number };
}

export interface VerifyAbsenceResult {
  /** Deterministically detected claim polarity. */
  polarity: ClaimPolarity;
  /** The negation cues that drove a `negative` polarity (evidence for the decision). */
  negation_cues: string[];
  /** What the source asserts about the effect, or null when the model step was skipped. */
  source_assertion: SourceAssertion | null;
  /** Final absence-aware verdict, decided by the fixed table. */
  label: AbsenceLabel;
  /** Neutral judgement confidence; 0 when nei or when support was dropped as ungroundable. */
  score: number;
  /** The grounded supporting span, or null when nei / ungroundable. */
  supporting_span: AbsenceSupportingSpan | null;
  /** True when a supporting sentence was returned but could not be located in the source. */
  grounding_dropped: boolean;
}

function neiResult(
  polarity: ClaimPolarity,
  cues: string[],
  assertion: SourceAssertion | null,
  groundingDropped: boolean
): VerifyAbsenceResult {
  return {
    polarity,
    negation_cues: cues,
    source_assertion: assertion,
    label: "nei",
    score: 0,
    supporting_span: null,
    grounding_dropped: groundingDropped,
  };
}

export interface VerifyAbsenceInput {
  claim: string;
  sourceText: string;
  /**
   * The neutral effect the claim is about, stated WITHOUT polarity (e.g. for the claim
   * "Drug X does not cause hepatotoxicity", the effect is "Drug X causes hepatotoxicity").
   * When omitted, the claim itself is passed to the model as the effect — acceptable because
   * the model only reports presence/absence and never the final label.
   */
  effect?: string;
}

/**
 * Verify an ABSENCE-aware claim against a source.
 *
 * Steps:
 *  1. Detect claim polarity DETERMINISTICALLY from the negation-cue lexicon (no model).
 *  2. Ask Claude the polarity-NEUTRAL question: does the source assert presence / absence /
 *     neither of the effect? (the entailment.ts model pattern, returning a verbatim sentence).
 *  3. GROUND that supporting sentence via lib/grounding.locateSpan; drop it (and fall back to
 *     `nei`) if it isn't in the source — an ungroundable support is a fabricated support.
 *  4. Map (polarity x source_assertion) -> final label by the FIXED table (no model).
 *
 * Deterministic given the injected Claude response.
 */
export async function verifyAbsenceClaim(
  input: VerifyAbsenceInput,
  deps: NegationEntailmentDeps = defaultDeps
): Promise<VerifyAbsenceResult> {
  const claim = input.claim.trim();
  const sourceText = input.sourceText.trim();

  if (claim.length === 0) {
    throw new Error("verifyAbsenceClaim: claim must be non-empty");
  }
  if (sourceText.length === 0) {
    throw new Error("verifyAbsenceClaim: sourceText must be non-empty");
  }

  const { polarity, cues } = detectPolarity(claim);
  const effect = (input.effect ?? claim).trim();

  const judgement = await deps.callClaudeForJson({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(effect.length > 0 ? effect : claim, sourceText),
    schema: AssertionJudgementSchema,
    maxTokens: 512,
  });

  // "neither": a genuine no-support -> nei. Nothing to ground.
  if (judgement.source_assertion === "neither") {
    return neiResult(polarity, cues, "neither", false);
  }

  // presence / absence: ground the supporting sentence before it counts.
  const located = locateSpan(sourceText, judgement.supporting_sentence);
  if (!located) {
    // Fabricated / ungroundable support -> drop it, fall back to nei, zero the score.
    return neiResult(polarity, cues, judgement.source_assertion, judgement.supporting_sentence.trim().length > 0);
  }

  const label = mapLabel(polarity, judgement.source_assertion);
  return {
    polarity,
    negation_cues: cues,
    source_assertion: judgement.source_assertion,
    label,
    score: judgement.confidence,
    supporting_span: {
      text: located.text,
      grounding: { status: located.status, start: located.start, end: located.end },
    },
    grounding_dropped: false,
  };
}

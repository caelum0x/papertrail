import { z } from "zod";
import { callClaudeForJson } from "../claude";
import { locateSpan, type SpanGroundingStatus } from "../grounding";

// Native port of MiniCheck (Tang, Laban & Durrett, EMNLP 2024): an efficient,
// sentence-level claim-vs-document ENTAILMENT check. The original is a trained
// classifier answering MiniCheck(document, claim) -> {0,1} with the prompt
// "Determine whether the provided claim is consistent with the corresponding
// document... all information in the claim is substantiated by the document."
//
// We keep that judgement — the one step the OSS did with a trained model — on
// Claude, but we do NOT trust the model's "Yes" on its own. MiniCheck's whole
// premise is that support must be *grounded* in the document. So Claude must also
// return the single supporting sentence it relied on, and we then GROUND that
// sentence back into the document via lib/grounding (verbatim span location).
//
// The grounding-downgrade invariant: a "supported" verdict whose supporting
// sentence cannot be located in the document is a fabricated support — the model
// pointed at text that isn't there. We downgrade it to UNSUPPORTED. This is the
// same trust guarantee the rest of PaperTrail enforces: no unsourced claims about
// the source. It complements lib/grounding's verbatim-span flagging with a
// sentence-level support judgement.

/** The consistency judgement Claude returns for a claim against a document. */
const EntailmentJudgementSchema = z.object({
  supported: z
    .boolean()
    .describe("True if ALL information in the claim is substantiated by the document."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Model confidence in the judgement, 0-1."),
  supporting_sentence: z
    .string()
    .describe(
      "When supported, the single sentence quoted VERBATIM from the document that substantiates the claim. Empty string when unsupported."
    ),
});
export type EntailmentJudgement = z.infer<typeof EntailmentJudgementSchema>;

/** The grounded result of an entailment check. */
export interface EntailmentResult {
  /** Final verdict after the grounding-downgrade invariant is applied. */
  supported: boolean;
  /**
   * Support score in [0, 1]. Mirrors MiniCheck's raw_prob of "supported".
   * Forced to 0 when a claimed support is downgraded for being ungroundable.
   */
  score: number;
  /**
   * The supporting sentence located verbatim in the document (with offsets), or
   * null when unsupported or when the model's supporting sentence was fabricated.
   */
  supportingSpan: {
    text: string;
    grounding: { status: SpanGroundingStatus; start: number; end: number };
  } | null;
}

export interface CheckEntailmentInput {
  claim: string;
  document: string;
}

/** Injectable Claude call so offline tests never touch the network or an API key. */
export interface EntailmentDeps {
  callClaudeForJson: typeof callClaudeForJson;
}

const defaultDeps: EntailmentDeps = { callClaudeForJson };

// MiniCheck's exact framing (minicheck/utils.py SYSTEM_PROMPT), extended to also
// demand the supporting sentence so we can ground it.
const SYSTEM_PROMPT =
  "Determine whether the provided claim is consistent with the corresponding document. " +
  "Consistency in this context implies that ALL information presented in the claim is " +
  "substantiated by the document. If not, it should be considered inconsistent. " +
  "When the claim is consistent, quote the single sentence from the document, VERBATIM " +
  "and character-for-character, that substantiates it. Do not paraphrase, summarize, or " +
  "invent a sentence — copy it exactly from the document. Respond only with the JSON object.";

function buildUserPrompt(claim: string, document: string): string {
  return (
    `Document:\n${document}\n\nClaim:\n${claim}\n\n` +
    'Respond with JSON: {"supported": boolean, "confidence": number 0-1, ' +
    '"supporting_sentence": string (verbatim document sentence when supported, else "")}'
  );
}

/**
 * Check whether `claim` is entailed (supported) by `document`.
 *
 * Steps:
 *  1. Claude judges consistency (MiniCheck's trained-model step) and returns the
 *     verbatim supporting sentence.
 *  2. We GROUND that sentence in the document via lib/grounding.locateSpan.
 *  3. Grounding-downgrade: if the model said "supported" but its supporting
 *     sentence is not in the document, the support is fabricated — we downgrade
 *     the verdict to unsupported and zero the score.
 *
 * Pure w.r.t. its inputs; deterministic given the injected Claude response.
 */
export async function checkEntailment(
  input: CheckEntailmentInput,
  deps: EntailmentDeps = defaultDeps
): Promise<EntailmentResult> {
  const claim = input.claim.trim();
  const document = input.document.trim();

  if (claim.length === 0) {
    throw new Error("checkEntailment: claim must be non-empty");
  }
  if (document.length === 0) {
    throw new Error("checkEntailment: document must be non-empty");
  }

  const judgement = await deps.callClaudeForJson({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(claim, document),
    schema: EntailmentJudgementSchema,
    maxTokens: 512,
  });

  // Unsupported per the model: nothing to ground, return honestly.
  if (!judgement.supported) {
    return { supported: false, score: judgement.confidence, supportingSpan: null };
  }

  // Supported per the model — but the support only counts if we can point to it
  // in the document. Ground the supporting sentence.
  const located = locateSpan(document, judgement.supporting_sentence);
  if (!located) {
    // Fabricated support: the model pointed at a sentence that isn't in the
    // document. MiniCheck's premise is violated -> downgrade to unsupported.
    return { supported: false, score: 0, supportingSpan: null };
  }

  return {
    supported: true,
    score: judgement.confidence,
    supportingSpan: {
      text: located.text,
      grounding: { status: located.status, start: located.start, end: located.end },
    },
  };
}

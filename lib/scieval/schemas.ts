import { z } from "zod";

// SciEval — a native TypeScript port of MultiVerS + SciFact scientific claim
// verification (backend/engines/multivers). MultiVerS is a multi-task model that,
// given a { claim, abstract } pair, jointly predicts:
//   1. a LABEL over the abstract: SUPPORTS / REFUTES(=CONTRADICT) / NEI (not enough info)
//   2. a set of RATIONALE sentences — the abstract sentences that justify the label.
// See multivers/model.py::decode (label_lookup {0:CONTRADICT, 1:NEI, 2:SUPPORT}) and
// predict.py (NEI => no rationale is emitted).
//
// We port the DETERMINISTIC structure natively (sentence segmentation of the abstract,
// the label taxonomy, and the "rationale must be a real abstract sentence" invariant),
// and delegate the single learned step — assigning the label + selecting rationale
// sentences — to Claude via callClaudeForJson + Zod. The trust layer then GROUNDS each
// selected rationale to the abstract with lib/grounding: a rationale that is not a
// verbatim abstract sentence is DROPPED. If a non-NEI label survives with no grounded
// rationale, we downgrade to NEI — never asserting a label we can't point to a sentence for.

// MultiVerS label taxonomy. "REFUTES" is MultiVerS's CONTRADICT class; we keep the
// SciFact-facing names (SUPPORTS / REFUTES / NEI) used by data.py::MultiVerSDataset.
export const ScievalLabel = z.enum(["SUPPORTS", "REFUTES", "NEI"]);
export type ScievalLabel = z.infer<typeof ScievalLabel>;

// Raw Claude output BEFORE grounding. `rationale_sentences` are the model's CLAIMED
// verbatim abstract sentences justifying the label; we do not trust them until
// lib/grounding locates each as a real substring of the abstract.
export const ScievalModelOutputSchema = z.object({
  label: ScievalLabel,
  rationale_sentences: z
    .array(z.string().min(1))
    .describe(
      "The exact abstract sentences that justify the label. Each MUST be a verbatim substring of the abstract. Empty for NEI."
    ),
  reasoning: z
    .string()
    .min(1)
    .describe("One- to two-sentence justification for the label, referencing the abstract's wording."),
});
export type ScievalModelOutput = z.infer<typeof ScievalModelOutputSchema>;

// A rationale sentence AFTER grounding: the VERBATIM substring located in the abstract
// (never the model's copy), with char offsets for in-place highlighting.
export interface GroundedRationale {
  sentence: string;
  grounding: {
    status: "exact" | "approximate";
    start: number;
    end: number;
  };
}

// The grounded, trustworthy verification returned to callers.
export interface ScievalVerification {
  label: ScievalLabel;
  rationales: GroundedRationale[];
  reasoning: string;
  // How many model-produced rationale sentences were dropped for being ungroundable.
  dropped_rationale_count: number;
  // True when the model asserted a non-NEI label but no rationale survived grounding,
  // so we downgraded the label to NEI (mirrors MultiVerS: a label with no supporting
  // sentence is not asserted).
  downgraded_to_nei: boolean;
}

// Request body for POST /api/scieval. Either supply the abstract directly, or omit it
// and let retrieval pull a matching cached source's raw_text for the claim.
export const ScievalRequestSchema = z.object({
  claim: z.string().trim().min(10).max(2000),
  abstract: z.string().trim().min(20).max(20000).optional(),
});
export type ScievalRequest = z.infer<typeof ScievalRequestSchema>;

// Discriminated outcome so the route can distinguish a completed verification from
// the case where no abstract was supplied AND retrieval found no confident source.
export type ScievalOutcome =
  | { status: "verified"; verification: ScievalVerification; source?: ScievalSourceRef }
  | { status: "no_source_found"; message: string };

// Minimal citation trail for a retrieved source, when the abstract came from retrieval.
export interface ScievalSourceRef {
  source_type: string;
  external_id: string;
  title: string | null;
  url: string;
  similarity: number;
}

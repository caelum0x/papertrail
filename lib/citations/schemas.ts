import { z } from "zod";

// Smart-citations (Scite-style) contracts. A "smart citation" doesn't just record
// that paper A cites paper B — it classifies HOW: does the citing passage present
// the cited work's finding as SUPPORTING it, CONTRASTING it, or merely MENTIONING
// it? Claude does the semantic stance reasoning; the deterministic trust layer
// (lib/grounding.ts) then grounds the citation-context sentence back to the citing
// text. An ungroundable context sentence is dropped — PaperTrail never surfaces a
// quote it cannot point to in the source.

export const CitationStance = z.enum(["supporting", "contrasting", "mentioning"]);
export type CitationStance = z.infer<typeof CitationStance>;

// Raw Claude output BEFORE grounding. `context_sentence` is the model's claimed
// verbatim citation-context sentence from the citing passage; we do NOT trust it
// until lib/grounding.ts locates it as a real substring of `citing_text`.
export const CitationClassificationSchema = z.object({
  stance: CitationStance,
  context_sentence: z
    .string()
    .min(1)
    .describe(
      "The exact sentence from the CITING passage that expresses the stance toward the cited work. Must be a verbatim substring of the citing text."
    ),
  reasoning: z
    .string()
    .min(1)
    .describe("One-sentence justification for the stance, referencing the citing passage's wording."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Model confidence in the stance classification, 0-1."),
});
export type CitationClassification = z.infer<typeof CitationClassificationSchema>;

// The grounded, trustworthy result returned to callers. The `context_sentence` here
// is the VERBATIM substring located in the citing text (never the model paraphrase),
// with char offsets for in-place highlighting.
export interface GroundedCitationClassification {
  stance: CitationStance;
  context_sentence: string;
  reasoning: string;
  confidence: number;
  grounding: {
    status: "exact" | "approximate";
    start: number;
    end: number;
  };
}

// Discriminated outcome so the route can distinguish "classified + grounded" from
// "the stance sentence couldn't be grounded, so we won't assert it."
export type CitationClassifyOutcome =
  | { status: "classified"; classification: GroundedCitationClassification }
  | { status: "ungroundable"; message: string };

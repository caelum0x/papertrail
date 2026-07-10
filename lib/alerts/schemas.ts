import { z } from "zod";

// Claude-assessed evidence alerts (Trialstreamer-style). When a NEW source relevant
// to a watched topic appears, Claude READS the source and assesses two things:
//   (1) RELEVANCE — is this source actually about the watched topic?
//   (2) IMPACT — given the topic's CURRENT pooled verdict (if any), would this new
//       source CONFIRM, WEAKEN, OVERTURN, or leave it unchanged (NONE)?
//
// This is heavy Claude reasoning over the source's natural-language content — not a
// keyword match. The deterministic TRUST LAYER (lib/grounding.ts) then grounds the
// model's supporting quote back to the source text. A quote we can't locate verbatim
// in the source is DROPPED and the assessment is withheld — PaperTrail never asserts
// a reason that quotes a sentence the source doesn't contain.

export const AlertRelevance = z.enum(["relevant", "not_relevant"]);
export type AlertRelevance = z.infer<typeof AlertRelevance>;

// How the new source would move the watched topic's current pooled verdict.
export const AlertImpact = z.enum(["confirms", "weakens", "overturns", "none"]);
export type AlertImpact = z.infer<typeof AlertImpact>;

// Raw Claude output BEFORE grounding. `evidence_quote` is the model's CLAIMED verbatim
// sentence from the source that justifies its relevance/impact call; we do NOT trust it
// until lib/grounding.ts locates it as a real substring of the source text.
export const AlertAssessmentSchema = z.object({
  relevant: AlertRelevance.describe(
    "Whether the candidate source is actually about the watched topic."
  ),
  relevance_reason: z
    .string()
    .min(1)
    .describe("One sentence on why the source is / isn't relevant to the watched topic."),
  likely_impact: AlertImpact.describe(
    "Given the topic's current verdict, whether this source confirms/weakens/overturns/leaves it unchanged."
  ),
  impact_reason: z
    .string()
    .min(1)
    .describe("One sentence on why the source has this impact on the current verdict."),
  evidence_quote: z
    .string()
    .min(1)
    .describe(
      "The EXACT, verbatim sentence copied from the SOURCE that best supports this assessment. Must be a substring of the source text — do not paraphrase or add ellipses."
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Calibrated confidence in the impact assessment, 0-1."),
});
export type AlertAssessment = z.infer<typeof AlertAssessmentSchema>;

// The grounded, trustworthy result returned to callers. `evidence_quote` here is the
// VERBATIM substring located in the source (never the model paraphrase), with char
// offsets for in-place highlighting.
export interface GroundedAlertAssessment {
  relevant: AlertRelevance;
  relevance_reason: string;
  likely_impact: AlertImpact;
  impact_reason: string;
  evidence_quote: string;
  confidence: number;
  grounding: {
    status: "exact" | "approximate";
    start: number;
    end: number;
  };
}

// Discriminated outcome so the route can distinguish "assessed + grounded" from
// "the supporting quote couldn't be grounded, so we won't assert this assessment."
export type AlertAssessOutcome =
  | { status: "assessed"; assessment: GroundedAlertAssessment }
  | { status: "ungroundable"; message: string };

// Request body schema for the org-scoped assess route. Validated at the API boundary
// before any LLM sees the text. `current_verdict` is the watched topic's existing
// pooled verdict/summary (optional — a brand-new watch may have none yet).
export const AssessAlertRequestSchema = z.object({
  topic: z
    .string()
    .trim()
    .min(5, "Describe the watched topic in at least 5 characters.")
    .max(500, "Topic is too long (max 500 characters)."),
  current_verdict: z
    .string()
    .trim()
    .max(2000, "Current verdict summary is too long (max 2000 characters).")
    .nullish(),
  source_text: z
    .string()
    .trim()
    .min(40, "Paste the source abstract/finding (at least 40 characters).")
    .max(20000, "Source text is too long (max 20000 characters)."),
  source_title: z
    .string()
    .trim()
    .max(500, "Source title is too long (max 500 characters).")
    .nullish(),
});
export type AssessAlertRequest = z.infer<typeof AssessAlertRequestSchema>;

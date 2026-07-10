// Zod schemas for the DRAFT ASSISTANT — Claude drafts a manuscript/grant section
// grounded in a VERIFIED evidence report, and every efficacy sentence is checked
// against the engine's pooled numbers. These schemas are the trust boundary: the
// raw JSON Claude returns for the draft is NEVER used before it validates here
// (CLAUDE.md — validate every structured LLM output). Numbers Claude states are
// treated as UNTRUSTED and reconciled downstream against the engine; these schemas
// only capture the prose + Claude's own (to-be-verified) supporting quotes.

import { z } from "zod";

// Section types a scientific writer actually drafts. Kept a closed union so the UI
// and prompt stay in lock-step; unknown values are rejected at the boundary.
export const DRAFT_SECTION_TYPES = [
  "abstract",
  "results",
  "discussion",
  "significance", // grant "Significance" section
  "background",
] as const;
export type DraftSectionType = (typeof DRAFT_SECTION_TYPES)[number];

// ---------------------------------------------------------------------------
// Public API input. `topic` drives the whole pipeline (retrieval + drafting);
// `section` optionally steers tone/structure. Boundary-validated so the route can
// hand raw JSON straight in. Mirrors the evidence-pipeline claim bounds.
// ---------------------------------------------------------------------------
export const DraftAssistInputSchema = z.object({
  topic: z.string().trim().min(10).max(2000),
  section: z.enum(DRAFT_SECTION_TYPES).optional(),
});
export type DraftAssistInput = z.infer<typeof DraftAssistInputSchema>;

// ---------------------------------------------------------------------------
// What Claude returns (UNTRUSTED). A list of sentences; each may carry a stated
// efficacy magnitude (percent reduction) and a supporting quote Claude claims comes
// verbatim from a source. Both are verified downstream — the quote is grounded to an
// exact source span, and any stated magnitude is reconciled against the engine's
// pooled number. Claude is asked to quote exactly, but nothing here guarantees it.
// ---------------------------------------------------------------------------
export const DraftSentenceDraftSchema = z.object({
  // The prose sentence Claude wrote.
  text: z.string().trim().min(1).max(2000),
  // True when the sentence makes a numeric/efficacy claim that must be reconciled
  // against the engine. Claude self-labels; we still re-parse the text to be safe.
  makesEfficacyClaim: z.boolean(),
  // Claude's stated relative reduction percent for this sentence, if any. UNTRUSTED —
  // reconciled against the engine's pooled reduction; the ENGINE value always wins.
  statedReductionPercent: z.number().finite().nullable().optional(),
  // A verbatim supporting quote Claude claims is in a source. Grounded downstream;
  // dropped if it can't be located in any cached source raw_text.
  supportingQuote: z.string().trim().max(1000).nullable().optional(),
});
export type DraftSentenceDraft = z.infer<typeof DraftSentenceDraftSchema>;

export const DraftDraftSchema = z.object({
  sentences: z.array(DraftSentenceDraftSchema).min(1).max(60),
});
export type DraftDraft = z.infer<typeof DraftDraftSchema>;

// ---------------------------------------------------------------------------
// Verified OUTPUT shapes (what the route returns). Every sentence carries its
// grounding/correction verdict; numbers here come from the ENGINE, never Claude.
// ---------------------------------------------------------------------------

// Where a supporting quote was grounded in a cached source (offsets for highlight).
export interface GroundedQuote {
  source_id: string;
  source_title: string | null;
  source_type: string;
  /** The verbatim substring located in the source raw_text (never Claude's paraphrase). */
  quote: string;
  start: number;
  end: number;
  status: "exact" | "approximate";
}

// One verified sentence. `grounded` = supported (quote located AND/OR no unverifiable
// numeric claim). `corrected` present when Claude's stated magnitude was overstated
// versus the engine and we rewrote the sentence to the engine's value.
export interface VerifiedSentence {
  text: string;
  makesEfficacyClaim: boolean;
  grounded: boolean;
  // The engine's pooled reduction percent this sentence is checked against (or null
  // when the report is insufficient / the sentence makes no numeric claim).
  engineReductionPercent: number | null;
  // Present ONLY when the sentence was auto-corrected: the original overstated text,
  // the stated value, and why. `text` above is already the corrected prose.
  corrected?: {
    original: string;
    statedReductionPercent: number;
    engineReductionPercent: number;
    reason: string;
  };
  // The grounded supporting quote, if one was located; omitted when none grounded.
  quote?: GroundedQuote;
}

// The used-source citation trail (mirrors EvidencePipeline UsedSource plus URL/id).
export interface DraftSource {
  id: string;
  title: string | null;
  source_type: string;
}

// The full verified draft the route returns.
export interface DraftAssistResult {
  topic: string;
  section: DraftSectionType;
  sentences: VerifiedSentence[];
  sources: DraftSource[];
  // Engine ground-truth surfaced for the header: the pooled number every efficacy
  // sentence is reconciled against, plus the report's own verdict/certainty. Null
  // when the evidence report was insufficient (Claude then drafts a hedged section).
  evidence: {
    sufficient: boolean;
    pooledReductionPercent: number | null;
    measure: string | null;
    certainty: string | null;
    verdict: string | null;
    rationale: string;
  };
  // Roll-up counts for the header badges.
  summary: {
    totalSentences: number;
    efficacyClaims: number;
    grounded: number;
    corrected: number;
  };
}

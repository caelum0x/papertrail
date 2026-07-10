import { z } from "zod";

// Zod schemas for the native deep-research orchestrator (lib/research/orchestrator.ts).
//
// This engine assimilates the PARALLEL DEEP-RESEARCH orchestration patterns from
// gpt-researcher (planner -> parallel sub-query executor -> per-source compression ->
// report writer) and open_deep_research (role-specialized models: a planner model, a
// compression model, a writer model). Every LLM structured output is validated against
// one of these schemas before use — never a raw JSON.parse (see CLAUDE.md conventions).

// --- Planner output ------------------------------------------------------------------
// The planner (gpt-researcher's plan_research_outline / ODR's write_research_brief +
// supervisor decomposition) turns one question into an ordered set of focused
// sub-questions, each independently researchable against our cached sources.

export const SubQuestionSchema = z.object({
  question: z.string().min(1),
  rationale: z.string().min(1),
});
export type SubQuestion = z.infer<typeof SubQuestionSchema>;

export const ResearchPlanSchema = z.object({
  // How the planner read the overall question (ODR's "research brief").
  interpretation: z.string().min(1),
  sub_questions: z.array(SubQuestionSchema).min(1).max(6),
});
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

// --- Compression output --------------------------------------------------------------
// For each retrieved source, the compression model distills the raw_text down to the
// spans relevant to the sub-question, preserving statements verbatim so they remain
// groundable (ODR's compress_research: "repeated and rewritten verbatim"). Every
// evidence item MUST carry a quote that is an exact substring of the source raw_text;
// the orchestrator drops any quote it cannot locate (grounding invariant).

export const CompressedEvidenceItemSchema = z.object({
  // A verbatim quote from the source raw_text supporting `point`.
  quote: z.string().min(1),
  // The claim-relevant point this quote supports (may paraphrase for readability).
  point: z.string().min(1),
});
export type CompressedEvidenceItem = z.infer<typeof CompressedEvidenceItemSchema>;

export const SourceCompressionSchema = z.object({
  // true when the source contains nothing relevant to the sub-question.
  irrelevant: z.boolean(),
  evidence: z.array(CompressedEvidenceItemSchema),
});
export type SourceCompression = z.infer<typeof SourceCompressionSchema>;

// --- Report writer output ------------------------------------------------------------
// The writer (gpt-researcher's ReportGenerator / ODR's final_report_generation) writes
// a cited report where every claim cites a compressed source by id + verbatim quote.
// The orchestrator grounds each citation's quote against that source's raw_text.

export const ReportCitationSchema = z.object({
  source_id: z.string().min(1),
  quote: z.string().min(1),
});
export type ReportCitation = z.infer<typeof ReportCitationSchema>;

export const ReportClaimSchema = z.object({
  text: z.string().min(1),
  citations: z.array(ReportCitationSchema),
});
export type ReportClaim = z.infer<typeof ReportClaimSchema>;

export const ReportSectionSchema = z.object({
  sub_question: z.string().min(1),
  claims: z.array(ReportClaimSchema),
});
export type ReportSection = z.infer<typeof ReportSectionSchema>;

export const ReportDraftSchema = z.object({
  summary: z.array(ReportClaimSchema),
  sections: z.array(ReportSectionSchema),
  limitations: z.string(),
});
export type ReportDraft = z.infer<typeof ReportDraftSchema>;

// --- Grounded public output ----------------------------------------------------------
// After grounding, claims carry GroundedCitations: each quote has been replaced by the
// verbatim substring actually located in the source, with char offsets, and any claim
// left with zero grounded citations is dropped (no unsourced claims about a source).

export interface GroundedCitation {
  source_id: string;
  // Verbatim substring of the source raw_text we located (not the model's paraphrase).
  quote: string;
  grounding: { status: "exact" | "approximate"; start: number; end: number };
}

export interface GroundedClaim {
  text: string;
  citations: GroundedCitation[];
}

export interface GroundedReportSection {
  sub_question: string;
  claims: GroundedClaim[];
}

export interface GroundedReport {
  summary: GroundedClaim[];
  sections: GroundedReportSection[];
  limitations: string;
  // How many model-produced citations were dropped for being ungroundable, plus how
  // many claims were dropped for ending up with no grounded citation at all.
  grounding_dropped_citations: number;
  grounding_dropped_claims: number;
}

// A per-sub-question evidence unit surfaced in the response: the sub-question, the
// sources whose compressed evidence fed the writer, and the grounded evidence itself.
export interface SubQuestionEvidence {
  sub_question: string;
  rationale: string;
  sources: Array<{
    source_id: string;
    external_id: string;
    title: string | null;
    url: string;
    similarity: number;
  }>;
  evidence: Array<{
    source_id: string;
    point: string;
    quote: string;
    grounding: { status: "exact" | "approximate"; start: number; end: number };
  }>;
}

export interface DeepResearchResult {
  question: string;
  plan: ResearchPlan;
  sub_question_evidence: SubQuestionEvidence[];
  report: GroundedReport;
}

// --- Route input ---------------------------------------------------------------------
export const ResearchRequestSchema = z.object({
  question: z.string().min(10, "Provide a research question of at least 10 characters.").max(2000),
});
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;

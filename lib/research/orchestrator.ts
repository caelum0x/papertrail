import { locateSpan } from "../grounding";
import { retrieveSources as defaultRetrieveSources } from "../agents/retrievalAgent";
import { callClaudeForJson as defaultCallClaudeForJson } from "../claude";
import { SourceCandidate } from "../schemas";
import {
  CompressedEvidenceItem,
  DeepResearchResult,
  GroundedCitation,
  GroundedClaim,
  GroundedReport,
  GroundedReportSection,
  ReportClaim,
  ReportDraft,
  ReportDraftSchema,
  ResearchPlan,
  ResearchPlanSchema,
  SourceCompression,
  SourceCompressionSchema,
  SubQuestion,
  SubQuestionEvidence,
} from "./schemas";

// ============================================================================
// Native parallel deep-research orchestrator.
//
// Assimilates two OSS engines into ONE native-TS pipeline over OUR stack:
//
//   gpt-researcher  (backend/engines/gpt-researcher):
//     plan_research_outline -> parallel sub-query search -> ContextCompressor
//     (per-source, query-relevant compression) -> ReportGenerator.
//
//   open_deep_research (backend/engines/open_deep_research):
//     write_research_brief -> supervisor fans out ConductResearch units in
//     PARALLEL (asyncio.gather) -> compress_research ("preserve statements
//     verbatim") -> final_report_generation. Uses ROLE-SPECIALIZED models: a
//     planner model, a compression model, a writer model.
//
// Ported natively:
//   1. PLAN   — Claude decomposes the question into focused sub-questions.
//   2. FAN-OUT — for each sub-question, retrieveSources over OUR cached
//                'sources' table (retrievalAgent), all sub-questions IN PARALLEL
//                (Promise.all, mirroring asyncio.gather).
//   3. COMPRESS — Claude compresses each retrieved source to claim-relevant
//                 evidence, preserving verbatim quotes (per-source, in parallel).
//   4. WRITE   — Claude writes a cited report over the compressed evidence.
//   5. GROUND  — every citation quote is located in the source raw_text
//                (lib/grounding.locateSpan); ungroundable quotes are dropped,
//                and claims left with no grounded citation are dropped.
//
// Role-specialized "models" are expressed as distinct system prompts + token
// budgets against Claude (one provider, three roles), keeping the deterministic
// parallelism/grounding native. retrieval and Claude are INJECTABLE for offline
// tests.
// ============================================================================

const MAX_SOURCES_PER_SUBQ = 3;
const MAX_RAW_TEXT_CHARS = 12000; // guard the compression prompt against huge full-texts

// --- Injectable dependencies -------------------------------------------------

export type RetrieveSourcesFn = (
  claim: string,
  opts?: { preferExternalId?: string }
) => Promise<SourceCandidate[]>;

export type ClaudeJsonCaller = <T>(params: {
  system: string;
  user: string;
  schema: { parse: (v: unknown) => T };
  maxTokens?: number;
}) => Promise<T>;

export interface OrchestratorDeps {
  retrieveSources: RetrieveSourcesFn;
  callClaudeForJson: ClaudeJsonCaller;
}

const defaultDeps: OrchestratorDeps = {
  retrieveSources: defaultRetrieveSources,
  callClaudeForJson: defaultCallClaudeForJson,
};

// --- Role prompts (open_deep_research's role-specialized models, one provider) -

const PLANNER_SYSTEM = [
  "You are a research supervisor for clinical-trial evidence. Given one research",
  "question, produce a research brief (your interpretation) and decompose it into",
  "focused, independently-researchable sub-questions — each answerable from primary",
  "clinical sources (trial registries, PubMed abstracts). Prefer 3-5 sub-questions",
  "covering the core efficacy claim, key subgroups/safety, and the certainty of",
  "evidence. Do not answer the question; only plan.",
  'Return ONLY JSON: {"interpretation": string, "sub_questions": [{"question": string, "rationale": string}]}.',
].join(" ");

const COMPRESSOR_SYSTEM = [
  "You are a research assistant compressing ONE source down to only the evidence",
  "relevant to a specific sub-question. Preserve relevant statements VERBATIM: every",
  "evidence item's `quote` MUST be copied character-for-character from the source text",
  "provided (no paraphrasing inside the quote, no ellipses, no added words). The",
  "`point` field may paraphrase for readability. If the source contains nothing",
  'relevant, return {"irrelevant": true, "evidence": []}. Never invent quotes.',
  'Return ONLY JSON: {"irrelevant": boolean, "evidence": [{"quote": string, "point": string}]}.',
].join(" ");

const WRITER_SYSTEM = [
  "You are writing a cited evidence report answering a research question, using ONLY",
  "the compressed evidence provided. Every claim MUST cite at least one source by its",
  "source_id and an exact `quote` copied verbatim from that source's listed evidence",
  "quotes. Never state a claim you cannot cite. Write a short `summary` (overall",
  "answer as cited claims), one `section` per sub-question (cited claims), and a plain",
  "`limitations` string. Do not cite a source_id that was not provided.",
  'Return ONLY JSON matching: {"summary": [{"text": string, "citations": [{"source_id": string, "quote": string}]}],',
  '"sections": [{"sub_question": string, "claims": [{"text": string, "citations": [...]}]}], "limitations": string}.',
].join(" ");

// --- Internal per-sub-question research unit (pre-grounding) ------------------

interface SubQuestionUnit {
  subQuestion: SubQuestion;
  sources: SourceCandidate[];
  // Compression keyed by source id, aligned to `sources`.
  compressions: Map<string, SourceCompression>;
}

// A flat catalogue of every source raw_text seen across the whole run, keyed by id,
// so grounding can resolve any citation the writer emits.
type RawTextIndex = Map<string, string>;

// --- Public entrypoint -------------------------------------------------------

/**
 * Run the full parallel deep-research pipeline for a question. Returns the plan,
 * per-sub-question grounded evidence, and a grounded cited report. All Claude output
 * is Zod-validated; every citation is grounded to a real source substring or dropped.
 * `deps` (retrieval + Claude) are injectable so tests run fully offline.
 */
export async function runResearch(
  question: string,
  deps: Partial<OrchestratorDeps> = {}
): Promise<DeepResearchResult> {
  const d: OrchestratorDeps = { ...defaultDeps, ...deps };

  // 1. PLAN — decompose the question into focused sub-questions.
  const plan = await planResearch(question, d);

  // 2 + 3. FAN-OUT + COMPRESS — one unit per sub-question, ALL IN PARALLEL
  // (mirrors open_deep_research's asyncio.gather over ConductResearch units).
  const units = await Promise.all(
    plan.sub_questions.map((sq) => researchSubQuestion(sq, d))
  );

  // Build a flat raw_text index across every source retrieved anywhere in the run.
  const rawTextById: RawTextIndex = new Map();
  for (const unit of units) {
    for (const src of unit.sources) rawTextById.set(src.id, src.raw_text);
  }

  // 4. WRITE — cited report over the compressed evidence.
  const draft = await writeReport(question, plan, units, d);

  // 5. GROUND — enforce the substring-of-source invariant on every citation.
  const report = groundReport(draft, rawTextById);

  const subQuestionEvidence = units.map((unit) => buildSubQuestionEvidence(unit));

  return { question, plan, sub_question_evidence: subQuestionEvidence, report };
}

// --- Step 1: planner ---------------------------------------------------------

async function planResearch(question: string, d: OrchestratorDeps): Promise<ResearchPlan> {
  return d.callClaudeForJson({
    system: PLANNER_SYSTEM,
    user: `Research question:\n${question}`,
    schema: ResearchPlanSchema,
    maxTokens: 1024,
  });
}

// --- Steps 2 + 3: retrieve (parallel) then compress (parallel per source) -----

async function researchSubQuestion(
  subQuestion: SubQuestion,
  d: OrchestratorDeps
): Promise<SubQuestionUnit> {
  const retrieved = await d.retrieveSources(subQuestion.question);
  const sources = retrieved.slice(0, MAX_SOURCES_PER_SUBQ);

  // Compress each source to sub-question-relevant evidence, in parallel. A single
  // source failing to compress must not sink the sub-question — it drops out.
  const compressed = await Promise.all(
    sources.map((src) =>
      compressSource(subQuestion.question, src, d)
        .then((c) => ({ id: src.id, compression: c }))
        .catch(() => ({ id: src.id, compression: null as SourceCompression | null }))
    )
  );

  const compressions = new Map<string, SourceCompression>();
  for (const { id, compression } of compressed) {
    if (compression && !compression.irrelevant && compression.evidence.length > 0) {
      compressions.set(id, compression);
    }
  }

  return { subQuestion, sources, compressions };
}

async function compressSource(
  question: string,
  source: SourceCandidate,
  d: OrchestratorDeps
): Promise<SourceCompression> {
  const rawText = source.raw_text.slice(0, MAX_RAW_TEXT_CHARS);
  const user = [
    `Sub-question: ${question}`,
    "",
    `Source id: ${source.id}`,
    `Source title: ${source.title ?? "(untitled)"}`,
    "Source text:",
    rawText,
  ].join("\n");

  return d.callClaudeForJson({
    system: COMPRESSOR_SYSTEM,
    user,
    schema: SourceCompressionSchema,
    maxTokens: 1024,
  });
}

// --- Step 4: report writer ---------------------------------------------------

async function writeReport(
  question: string,
  plan: ResearchPlan,
  units: SubQuestionUnit[],
  d: OrchestratorDeps
): Promise<ReportDraft> {
  const user = [
    `Research question: ${question}`,
    `Interpretation: ${plan.interpretation}`,
    "",
    "Compressed evidence, grouped by sub-question:",
    renderEvidenceForWriter(units),
    "",
    "Write the cited report. Cite ONLY the source_ids and quotes listed above.",
  ].join("\n");

  return d.callClaudeForJson({
    system: WRITER_SYSTEM,
    user,
    schema: ReportDraftSchema,
    maxTokens: 2048,
  });
}

/** Render the compressed evidence into a compact, id-anchored block for the writer. */
function renderEvidenceForWriter(units: SubQuestionUnit[]): string {
  const blocks: string[] = [];
  for (const unit of units) {
    blocks.push(`\n## Sub-question: ${unit.subQuestion.question}`);
    if (unit.compressions.size === 0) {
      blocks.push("(no relevant evidence found in the cached sources)");
      continue;
    }
    for (const source of unit.sources) {
      const compression = unit.compressions.get(source.id);
      if (!compression) continue;
      blocks.push(`### Source ${source.id} — ${source.title ?? "(untitled)"}`);
      for (const item of compression.evidence) {
        blocks.push(`- point: ${item.point}\n  quote: "${item.quote}"`);
      }
    }
  }
  return blocks.join("\n");
}

// --- Step 5: grounding -------------------------------------------------------
//
// The grounding invariant (CLAUDE.md): every quote a model attributes to a source
// must be a real, locatable substring of that source's raw_text. We locate each
// citation quote via lib/grounding.locateSpan, replace it with the verbatim text we
// actually found (+ offsets), drop citations we cannot locate, and drop any claim
// left with zero grounded citations. Returns NEW objects; inputs are not mutated.

function groundReport(draft: ReportDraft, rawTextById: RawTextIndex): GroundedReport {
  let droppedCitations = 0;
  let droppedClaims = 0;

  const groundClaims = (claims: readonly ReportClaim[]): GroundedClaim[] => {
    const grounded: GroundedClaim[] = [];
    for (const claim of claims) {
      const citations: GroundedCitation[] = [];
      for (const citation of claim.citations) {
        const rawText = rawTextById.get(citation.source_id);
        const located = rawText ? locateSpan(rawText, citation.quote) : null;
        if (!located) {
          droppedCitations += 1;
          continue;
        }
        citations.push({
          source_id: citation.source_id,
          quote: located.text,
          grounding: { status: located.status, start: located.start, end: located.end },
        });
      }
      if (citations.length === 0) {
        droppedClaims += 1;
        continue;
      }
      grounded.push({ text: claim.text, citations });
    }
    return grounded;
  };

  const summary = groundClaims(draft.summary);
  const sections: GroundedReportSection[] = draft.sections.map((section) => ({
    sub_question: section.sub_question,
    claims: groundClaims(section.claims),
  }));

  return {
    summary,
    sections,
    limitations: draft.limitations,
    grounding_dropped_citations: droppedCitations,
    grounding_dropped_claims: droppedClaims,
  };
}

// --- Surface per-sub-question evidence (grounded) ----------------------------

function buildSubQuestionEvidence(unit: SubQuestionUnit): SubQuestionEvidence {
  const usedSources = unit.sources.filter((s) => unit.compressions.has(s.id));

  const evidence: SubQuestionEvidence["evidence"] = [];
  for (const source of usedSources) {
    const compression = unit.compressions.get(source.id);
    if (!compression) continue;
    for (const item of compression.evidence) {
      const grounded = groundEvidenceItem(item, source.raw_text);
      if (grounded) {
        evidence.push({ source_id: source.id, point: item.point, ...grounded });
      }
    }
  }

  return {
    sub_question: unit.subQuestion.question,
    rationale: unit.subQuestion.rationale,
    sources: usedSources.map((s) => ({
      source_id: s.id,
      external_id: s.external_id,
      title: s.title,
      url: s.url,
      similarity: s.similarity,
    })),
    evidence,
  };
}

/** Ground a single compressed evidence quote against its source, or null if unlocatable. */
function groundEvidenceItem(
  item: CompressedEvidenceItem,
  rawText: string
): { quote: string; grounding: { status: "exact" | "approximate"; start: number; end: number } } | null {
  const located = locateSpan(rawText, item.quote);
  if (!located) return null;
  return {
    quote: located.text,
    grounding: { status: located.status, start: located.start, end: located.end },
  };
}

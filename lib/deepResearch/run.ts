// MULTI-AGENT DEEP RESEARCH — the heavy-Claude, engine-grounded core.
//
// Given ONE research question, this runs a three-stage multi-agent workflow
// (gpt-researcher / open_deep_research-style, but grounded):
//
//   Stage 1 — PLAN (Claude):  decompose the question into 3-6 focused
//     sub-questions (callClaudeForJson + Zod ResearchPlanSchema). One Claude call
//     that does genuinely hard work: reasoning about what evidence is needed.
//
//   Stage 2 — EVIDENCE (deterministic):  for EACH sub-question, run
//     runEvidencePipeline (lib/evidencePipeline) to retrieve cached primary
//     sources and pool their registered effects into a verified evidence report.
//     Every number in the workflow originates here — NO LLM in the numeric loop.
//
//   Stage 3 — SYNTHESIS (Claude):  write a structured, cited report ACROSS the
//     per-sub-question answers. Claude only cites source spans we already hold;
//     lib/grounding.ts then re-locates every quote in the source raw_text and
//     DROPS any citation (and any claim left with no citation) it cannot ground.
//
// This fans out many Claude + pipeline calls — 1 plan + N evidence pipelines
// (each with its own retrieval) + 1 synthesis = genuinely high-volume Claude use,
// made safe by the deterministic trust layer underneath it.
//
// Retrieval AND the pipeline are INJECTABLE so the whole workflow runs offline in
// tests with fixture sources and a mocked Claude — no live embeddings, DB, or API.

import type { Pool } from "pg";
import { callClaudeForJson } from "../claude";
import { runEvidencePipeline } from "../evidencePipeline";
import type {
  EvidencePipelineInput,
  EvidencePipelineResult,
  SourceRetriever,
} from "../evidencePipeline";
import { retrieveSources } from "../agents/retrievalAgent";
import { locateSpan } from "../grounding";
import {
  ResearchPlanSchema,
  SynthesisReportSchema,
  type ResearchPlan,
  type SubQuestion,
  type SynthesisReport,
  type SynthesisClaim,
} from "./schemas";

// --- Injectable seams -------------------------------------------------------
//
// Both Claude calls and the evidence pipeline are injectable. Defaults use the
// real Claude client + the real pipeline (which itself uses the real retrieval
// agent). Tests inject deterministic stubs to run the full fan-out offline.

// The verified evidence gathered for one sub-question: the pipeline result plus
// the raw_text of each retrieved source (keyed by id), which the pipeline result
// does not carry but grounding in Stage 3 needs. Captured by the researcher so we
// never re-derive it or edit the pipeline we don't own.
export interface SubQuestionResearch {
  result: EvidencePipelineResult;
  rawTextById: Map<string, string>;
}

/**
 * Researches one sub-question end to end: retrieve cached sources + pool their
 * effects (the deterministic pipeline), and return the result together with the
 * source raw_text needed for grounding. Default implementation wraps the real
 * retriever to capture raw_text, then runs lib/evidencePipeline. Tests inject a
 * stub to run offline.
 */
export type SubQuestionResearcher = (
  input: EvidencePipelineInput
) => Promise<SubQuestionResearch>;

/** Structured Claude call. Default: callClaudeForJson (validated against Zod). */
export type ClaudeJsonCaller = <T>(params: {
  system: string;
  user: string;
  schema: { parse: (v: unknown) => T };
  maxTokens?: number;
}) => Promise<T>;

export interface DeepResearchDeps {
  /** Researches one sub-question (retrieve + pool + capture raw_text). */
  researchSubQuestion?: SubQuestionResearcher;
  /** The structured Claude caller for plan + synthesis. */
  callClaude?: ClaudeJsonCaller;
  /** Optional retriever used by the default researcher (offline tests). */
  retrieve?: SourceRetriever;
  /** Cap on sub-questions actually researched (defensive; plan is already ≤ 6). */
  maxSubQuestions?: number;
}

// Build the default researcher. It wraps the retriever so that, for each
// sub-question, we capture every retrieved SourceCandidate's raw_text (keyed by
// id) as it flows into the pipeline — the pipeline's own result intentionally
// omits raw_text, and we must NOT edit that file. Grounding in Stage 3 quotes
// against exactly these captured texts.
function makeDefaultResearcher(
  pool: Pool,
  retrieve?: SourceRetriever
): SubQuestionResearcher {
  const baseRetrieve: SourceRetriever =
    retrieve ?? ((q: string) => retrieveSources(q));

  return async (input) => {
    const captured = new Map<string, string>();
    const capturingRetrieve: SourceRetriever = async (q) => {
      const candidates = await baseRetrieve(q);
      for (const c of candidates) {
        if (!captured.has(c.id)) captured.set(c.id, c.raw_text ?? "");
      }
      return candidates;
    };
    const result = await runEvidencePipeline(pool, input, {
      retrieve: capturingRetrieve,
    });
    return { result, rawTextById: captured };
  };
}

// --- Result shapes ----------------------------------------------------------

/** One source cited in the final report, deduplicated across sub-questions. */
export interface ReportSource {
  id: string;
  title: string | null;
  source_type: string;
}

/** A grounded citation: quote re-located verbatim in the source raw_text. */
export interface GroundedReportCitation {
  source_id: string;
  quote: string;
  grounding: { status: "exact" | "approximate"; start: number; end: number };
}

export interface GroundedReportClaim {
  text: string;
  citations: GroundedReportCitation[];
}

export interface GroundedReportSection {
  sub_question: string;
  claims: GroundedReportClaim[];
}

/** The evidence gathered for a single sub-question (the deterministic layer). */
export interface SubQuestionEvidence {
  sub_question: SubQuestion;
  result: EvidencePipelineResult;
  /** raw_text of each retrieved source (keyed by id), for grounding citations. */
  rawTextById: Map<string, string>;
}

export interface DeepResearchReport {
  question: string;
  plan: ResearchPlan;
  /** Per-sub-question verified evidence (retrieval + pooled report + trail). */
  evidence: SubQuestionEvidence[];
  /** All distinct sources cited across the report, for the citation panel. */
  sources: ReportSource[];
  summary: GroundedReportClaim[];
  sections: GroundedReportSection[];
  limitations: string;
  /** How many model-produced claims were dropped for being ungroundable. */
  dropped_claims: number;
  /** How many sub-questions yielded a poolable (ok) evidence report. */
  supported_sub_questions: number;
}

// --- Stage 1: PLAN ----------------------------------------------------------

const PLAN_SYSTEM = `You are a biomedical research strategist decomposing a broad research question into focused, individually-answerable sub-questions for an evidence-synthesis system.

The downstream system answers each sub-question by retrieving primary clinical sources (trials, PubMed records) and pooling their registered effect estimates. So each sub-question should be answerable from primary efficacy/safety evidence about a specific intervention, population, endpoint, or comparison — NOT open-ended background questions.

Rules:
- Produce 3 to 6 sub-questions. Fewer is better than padding with vague ones.
- Each sub-question must be specific enough that a trial or study could directly address it.
- Give a "search_query" optimised for semantic retrieval over a corpus of trial and PubMed abstracts (key intervention + condition + endpoint terms), distinct from the prose question when that helps retrieval.
- Do NOT answer the questions. Do NOT invent study results. You are only planning what to investigate.

Respond with ONLY a JSON object matching this shape:
{
  "interpretation": string,
  "sub_questions": [
    { "question": string, "rationale": string, "search_query": string }
  ]
}`;

async function planSubQuestions(
  question: string,
  call: ClaudeJsonCaller
): Promise<ResearchPlan> {
  return call({
    system: PLAN_SYSTEM,
    user: `Research question:\n${question}\n\nDecompose it into 3-6 focused sub-questions, each answerable from primary clinical evidence.`,
    schema: ResearchPlanSchema,
    maxTokens: 1500,
  });
}

// --- Stage 3: SYNTHESIS -----------------------------------------------------

const SYNTH_SYSTEM = `You are writing a structured, cited evidence report that synthesises across several sub-question analyses. Each sub-question was answered by a deterministic engine that retrieved primary sources and pooled their registered effect estimates.

CRITICAL grounding rules:
- Every numeric figure you state (effect sizes, reductions, CIs, GRADE ratings, study counts) MUST come from the ENGINE FINDINGS provided — never invent or recompute a number.
- Every claim you write MUST cite at least one source by its "source_id" and re-quote an EXACT verbatim substring of that source's provided text as "quote". Copy the quote character-for-character; do not paraphrase inside a quote.
- Only cite source_ids that appear in the provided material. Do not introduce facts absent from the findings and source spans.
- Where sub-questions had insufficient evidence, say so honestly rather than overstating.
- Keep "limitations" to an honest one-paragraph summary of what this evidence cannot establish (or "").

Structure: a short "summary" (each sentence individually cited), one "section" per sub-question (echo its wording), and "limitations".

Respond with ONLY a JSON object matching this shape:
{
  "summary": [ { "text": string, "citations": [ { "source_id": string, "quote": string } ] } ],
  "sections": [ { "sub_question": string, "claims": [ { "text": string, "citations": [ { "source_id": string, "quote": string } ] } ] } ],
  "limitations": string
}`;

// Compact, model-facing rendering of one sub-question's engine result: the pooled
// numbers the engine computed (which Claude may cite but never alter) plus the
// verbatim source spans it is allowed to quote. Numbers come ONLY from here.
function renderEvidenceForModel(ev: SubQuestionEvidence): string {
  const { sub_question, result } = ev;
  const lines: string[] = [];
  lines.push(`SUB-QUESTION: ${sub_question.question}`);

  const report = result.report;
  if (report.ok) {
    const p = report.pooled;
    lines.push(
      `ENGINE FINDING (deterministic, cite verbatim — do not alter): pooled ${p.k} ${p.measure} studies, random-effects estimate ${p.random.point} (95% CI ${p.random.ciLower}-${p.random.ciUpper}), I²=${p.heterogeneity.iSquared}%. GRADE certainty: ${report.certainty.certainty}. Verdict vs claim: ${report.verdict.verdict}.`
    );
    lines.push(`ENGINE RATIONALE: ${report.rationale}`);
  } else {
    lines.push(
      `ENGINE FINDING: insufficient evidence — ${report.reason} (usable studies: ${report.usableStudies}). State this honestly.`
    );
  }

  if (result.usedSources.length > 0) {
    lines.push("SOURCE SPANS (quote verbatim, cite by source_id):");
    for (const s of result.usedSources) {
      lines.push(`  source_id=${s.id} | ${s.source_type} | ${s.title ?? "(untitled)"}`);
    }
  } else {
    lines.push("SOURCE SPANS: none retrieved for this sub-question.");
  }
  return lines.join("\n");
}

async function synthesiseReport(
  question: string,
  evidence: SubQuestionEvidence[],
  call: ClaudeJsonCaller
): Promise<SynthesisReport> {
  const evidenceBlock = evidence.map(renderEvidenceForModel).join("\n\n");
  const rawTextBlock = buildRawTextBlock(evidence);

  const user = `Overall research question:\n${question}\n\nPer-sub-question engine findings:\n${evidenceBlock}\n\nFull source texts you may quote (cite by source_id, quote verbatim):\n${rawTextBlock}\n\nWrite the cited report. Every number must come from an ENGINE FINDING; every claim must cite a source_id and re-quote its text verbatim.`;

  return call({
    system: SYNTH_SYSTEM,
    user,
    schema: SynthesisReportSchema,
    maxTokens: 4000,
  });
}

// The verbatim source texts Claude is permitted to quote, keyed by the same
// source_id it must cite. Deduplicated across sub-questions.
function buildRawTextBlock(evidence: SubQuestionEvidence[]): string {
  const byId = collectRawTextById(evidence);
  const blocks: string[] = [];
  for (const [id, text] of byId) {
    blocks.push(`source_id=${id}:\n"""\n${text}\n"""`);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : "(no source texts available)";
}

// --- Grounding: re-locate every cited quote in its source raw_text ----------

// Merge the per-sub-question raw_text maps (captured by the researcher) into one
// id -> raw_text lookup for grounding every synthesis citation. The pipeline's own
// result omits raw_text by design, so this is our sole grounding source of truth.
function collectRawTextById(evidence: SubQuestionEvidence[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const ev of evidence) {
    for (const [id, text] of ev.rawTextById) {
      if (!map.has(id)) map.set(id, text);
    }
  }
  return map;
}

// Ground a set of synthesis claims: for each claim, keep only citations whose
// quote can be located verbatim in the cited source's raw_text; drop claims that
// lose all citations. Pure — returns new objects, mutates nothing.
function groundClaims(
  claims: readonly SynthesisClaim[],
  rawTextById: Map<string, string>
): { grounded: GroundedReportClaim[]; dropped: number } {
  const grounded: GroundedReportClaim[] = [];
  let dropped = 0;

  for (const claim of claims) {
    const citations: GroundedReportCitation[] = [];
    for (const cite of claim.citations) {
      const rawText = rawTextById.get(cite.source_id);
      if (!rawText) continue; // citing a source not in scope → dropped
      const located = locateSpan(rawText, cite.quote);
      if (!located) continue; // ungroundable quote → dropped (never trusted)
      citations.push({
        source_id: cite.source_id,
        quote: located.text,
        grounding: { status: located.status, start: located.start, end: located.end },
      });
    }
    if (citations.length === 0) {
      dropped += 1;
      continue;
    }
    grounded.push({ text: claim.text, citations });
  }

  return { grounded, dropped };
}

// Deduplicate every source that actually contributed to a grounded citation into
// the report-level citation panel.
function collectCitedSources(
  evidence: SubQuestionEvidence[]
): ReportSource[] {
  const byId = new Map<string, ReportSource>();
  for (const ev of evidence) {
    for (const s of ev.result.usedSources) {
      if (!byId.has(s.id)) {
        byId.set(s.id, { id: s.id, title: s.title, source_type: s.source_type });
      }
    }
  }
  return [...byId.values()];
}

// --- Orchestration ----------------------------------------------------------

/**
 * Run the full multi-agent deep-research workflow for one research question.
 *
 * Stage 1: Claude decomposes the question into 3-6 sub-questions (validated).
 * Stage 2: for each sub-question, the deterministic evidence pipeline retrieves
 *   cached primary sources and pools their registered effects — every number
 *   originates here, no LLM in the numeric loop.
 * Stage 3: Claude synthesises a structured cited report across the sub-answers;
 *   every cited quote is re-grounded against the source raw_text and dropped if
 *   it cannot be located, so the reader only ever sees grounded claims.
 *
 * All Claude calls and the evidence pipeline are injectable, so the whole
 * fan-out runs offline in tests. Throws only if Stage 1 fails to produce a valid
 * plan (there is nothing to research without one); individual sub-question
 * pipeline failures are captured as honest insufficient evidence, not fatal.
 */
export async function runDeepResearch(
  pool: Pool,
  question: string,
  deps?: DeepResearchDeps
): Promise<DeepResearchReport> {
  const call: ClaudeJsonCaller = deps?.callClaude ?? callClaudeForJson;
  const research: SubQuestionResearcher =
    deps?.researchSubQuestion ?? makeDefaultResearcher(pool, deps?.retrieve);

  // Stage 1 — PLAN. A failure here is fatal: without a plan there is nothing to
  // research. The caller surfaces this as a user-visible error state.
  const plan = await planSubQuestions(question, call);

  const cap = deps?.maxSubQuestions ?? plan.sub_questions.length;
  const subQuestions = plan.sub_questions.slice(0, cap);

  // Stage 2 — EVIDENCE. Fan out one deterministic pipeline per sub-question, in
  // parallel. A single sub-question failure becomes honest insufficient evidence
  // for that branch — it must not sink the whole report.
  const evidence: SubQuestionEvidence[] = await Promise.all(
    subQuestions.map(async (sq) => {
      const input: EvidencePipelineInput = {
        claim: sq.question,
        ...(sq.search_query ? { query: sq.search_query } : {}),
      };
      try {
        const { result, rawTextById } = await research(input);
        return { sub_question: sq, result, rawTextById };
      } catch (err) {
        return {
          sub_question: sq,
          result: insufficientPipelineResult(sq.question, String(err)),
          rawTextById: new Map<string, string>(),
        };
      }
    })
  );

  const supported = evidence.filter((e) => e.result.report.ok).length;
  const rawTextById = collectRawTextById(evidence);

  // Stage 3 — SYNTHESIS. Claude writes the cited report; a synthesis failure is
  // non-fatal — we still return the verified per-sub-question evidence so the
  // reader gets the deterministic layer even if long-form composition failed.
  let report: SynthesisReport;
  try {
    report = await synthesiseReport(question, evidence, call);
  } catch {
    report = { summary: [], sections: [], limitations: "" };
  }

  const summaryGround = groundClaims(report.summary, rawTextById);
  let dropped = summaryGround.dropped;

  const sections: GroundedReportSection[] = report.sections.map((section) => {
    const g = groundClaims(section.claims, rawTextById);
    dropped += g.dropped;
    return { sub_question: section.sub_question, claims: g.grounded };
  });

  return {
    question,
    plan,
    evidence,
    sources: collectCitedSources(evidence),
    summary: summaryGround.grounded,
    sections,
    limitations: report.limitations,
    dropped_claims: dropped,
    supported_sub_questions: supported,
  };
}

// An honest "this sub-question could not be researched" result in the exact shape
// runEvidencePipeline returns, so the synthesis + UI handle it uniformly.
function insufficientPipelineResult(
  claim: string,
  reason: string
): EvidencePipelineResult {
  return {
    claim,
    usedSources: [],
    skipped: [],
    report: {
      ok: false,
      claim,
      reason: `This sub-question could not be researched (${reason}). Reported honestly rather than fabricating evidence.`,
      claimedReductionPercent: null,
      usableStudies: 0,
      skipped: [],
    },
  };
}

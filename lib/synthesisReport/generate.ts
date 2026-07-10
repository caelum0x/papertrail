// LONG-FORM CITED SYNTHESIS (STORM-style) — generate a structured, multi-section,
// fully-cited evidence review for a topic/claim, grounded in PaperTrail's
// deterministic evidence pipeline.
//
// The division of labour is the whole point:
//
//   ENGINE supplies every NUMBER. We run runEvidencePipeline for the topic to get the
//   verified pooled estimate, heterogeneity, GRADE certainty, and claim-vs-pool verdict.
//   Claude never invents a figure — the Findings/Certainty prose must state the engine's
//   numbers verbatim, and we hand those numbers to Claude as fixed facts.
//
//   CLAUDE writes the PROSE. Given the topic, the engine facts, and the cached source
//   snippets, Claude drafts a Background / Methods / Findings / Certainty / Limitations
//   review with inline citations to the used sources. This is genuine long-form
//   generation — multi-section synthesis over multiple papers — not thin RAG.
//
//   The ENGINE then GROUNDS Claude's prose. Every factual sentence Claude marks with a
//   source_quote is located in that source's cached raw_text via lib/grounding.locateSpan;
//   a sentence whose quote can't be found is DROPPED (the CLAUDE.md rule: no unsourced
//   claim about a source). Interpretive/connective sentences (no quote) are kept as-is.
//
// Retrieval and the Claude call are INJECTABLE so tests run the whole flow with fixture
// sources and a mock model — no live embeddings, DB, or API. This file performs no direct
// DB or network I/O of its own; all of that lives behind the injected retriever/caller.

import type { Pool } from "pg";
import { retrieveSources } from "../agents/retrievalAgent";
import type { SourceCandidate } from "../schemas";
import { runEvidencePipeline } from "../evidencePipeline";
import type { EvidencePipelineResult } from "../evidencePipeline";
import { locateSpan } from "../grounding";
import {
  isStormEnabled,
  generateStormArticle,
  type StormResult,
  type StormSource,
} from "../engines/storm";
import {
  SynthesisDraftSchema,
  type SynthesisDraft,
  type DraftSection,
  type DraftSentence,
  type EngineFacts,
  type GroundedSection,
  type GroundedSentence,
  type GroundingRef,
  type SynthesisReport,
  type SynthesisReportInput,
  SynthesisReportInputSchema,
  SYNTHESIS_SECTION_IDS,
  type SynthesisSectionId,
} from "./schemas";

// A model caller returns Claude's draft as validated JSON. Default calls the real
// Claude via callClaudeForJson; tests inject a stub returning a fixture draft.
export type DraftCaller = (args: {
  system: string;
  user: string;
}) => Promise<SynthesisDraft>;

// A retriever returns the cached source candidates (WITH raw_text) for grounding.
// Same shape the evidence pipeline consumes, so we can thread it into both.
export type ReportRetriever = (query: string) => Promise<SourceCandidate[]>;

const MAX_SNIPPET_CHARS = 1500;
const SECTION_HEADINGS: Record<SynthesisSectionId, string> = {
  background: "Background",
  methods: "Methods",
  findings: "Findings",
  certainty: "Certainty of Evidence",
  limitations: "Limitations",
};

function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Distil the deterministic pipeline result into the engine facts panel — the single
// source of truth for every number in the report. Reads only engine output.
function toEngineFacts(result: EvidencePipelineResult): EngineFacts {
  const report = result.report;
  if (report.ok) {
    const r = report.pooled.random;
    return {
      poolable: true,
      measure: report.pooled.measure,
      k: report.pooled.k,
      pooledPoint: round(r.point, 3),
      pooledCiLower: round(r.ciLower, 3),
      pooledCiUpper: round(r.ciUpper, 3),
      pooledReductionPercent: round(r.reductionPercent, 1),
      iSquared: round(report.pooled.heterogeneity.iSquared, 1),
      certainty: report.certainty.certainty,
      verdict: report.verdict.verdict,
      claimedReductionPercent: report.claimedReductionPercent,
      engineRationale: report.rationale,
    };
  }
  return {
    poolable: false,
    measure: null,
    k: report.usableStudies,
    pooledPoint: null,
    pooledCiLower: null,
    pooledCiUpper: null,
    pooledReductionPercent: null,
    iSquared: null,
    certainty: null,
    verdict: null,
    claimedReductionPercent: report.claimedReductionPercent,
    engineRationale: report.reason,
  };
}

// A compact, numbered evidence packet for the drafter: the topic, the ENGINE facts
// (verbatim), and one snippet per used source (its cached raw_text, truncated). The
// drafter cites sources by id and quotes ONLY from these snippets.
function buildDraftContext(
  topic: string,
  facts: EngineFacts,
  sources: readonly SourceCandidate[]
): string {
  const lines: string[] = [];
  lines.push(`TOPIC / CLAIM:\n${topic}`);
  lines.push("");
  lines.push("ENGINE FACTS (these are the ONLY numbers you may state; quote them verbatim):");
  if (facts.poolable) {
    lines.push(`- Measure: ${facts.measure}`);
    lines.push(`- Studies pooled (k): ${facts.k}`);
    lines.push(
      `- Pooled random-effects estimate: ${facts.pooledPoint} (95% CI ${facts.pooledCiLower}–${facts.pooledCiUpper})`
    );
    lines.push(`- Pooled reduction: ${facts.pooledReductionPercent}%`);
    lines.push(`- Heterogeneity I²: ${facts.iSquared}%`);
    lines.push(`- GRADE certainty: ${facts.certainty}`);
    lines.push(`- Claim-vs-pool verdict: ${facts.verdict}`);
  } else {
    lines.push(`- Pooling not possible: ${facts.engineRationale}`);
  }
  lines.push("");
  lines.push("SOURCES (cite by these ids; quote ONLY text that appears in a snippet):");
  sources.forEach((s, i) => {
    const snippet = (s.raw_text ?? "").slice(0, MAX_SNIPPET_CHARS);
    lines.push(
      `[${i + 1}] id=${s.id} type=${s.source_type} title=${s.title ?? "(untitled)"}\n${snippet}`
    );
    lines.push("");
  });
  return lines.join("\n");
}

const SYSTEM_PROMPT =
  "You are a systematic-review medical writer for PaperTrail. You draft a structured, " +
  "fully-cited evidence review from a fixed set of engine-computed facts and cached source " +
  "snippets. Hard rules you must never break:\n" +
  "1. You NEVER invent, recompute, or reword any number. Every figure (effect size, CI, %, " +
  "I², k) must be stated EXACTLY as given in ENGINE FACTS. If a number is not in ENGINE FACTS, " +
  "do not state it.\n" +
  "2. Every factual sentence about a source must set `source_quote` to a VERBATIM substring " +
  "copied from that source's snippet, and cite that source's id in `citations`. If you cannot " +
  "quote a source for a factual claim, do not make the claim.\n" +
  "3. Connective / interpretive sentences that state no source-specific fact may set " +
  "`source_quote` to null and `citations` to [].\n" +
  "4. Write five sections with ids exactly: background, methods, findings, certainty, limitations. " +
  "The findings and certainty sections must state the engine's pooled numbers and GRADE certainty " +
  "verbatim.\n" +
  "Return ONLY a JSON object of shape {title, sections:[{id, heading, sentences:[{text, citations, " +
  "source_quote}]}]}.";

// Real Claude drafter. Kept out of the default export path so tests can inject a stub
// without importing the SDK. Lazily imports lib/claude to avoid pulling the SDK into
// pure unit tests of the grounding logic.
async function claudeDraft(args: { system: string; user: string }): Promise<SynthesisDraft> {
  const { callClaudeForJson } = await import("../claude");
  return callClaudeForJson({
    system: args.system,
    user: args.user,
    schema: SynthesisDraftSchema,
    maxTokens: 4096,
  });
}

// Ground ONE drafted sentence against the cached sources. A factual sentence (has a
// source_quote) must locate that quote in one of its cited sources' raw_text; if it
// can't, the sentence is dropped (returns null). A connective sentence (no quote) is
// kept with grounding=null. Returns { kept } | { dropped } so the caller can count.
function groundSentence(
  sentence: DraftSentence,
  sourcesById: ReadonlyMap<string, SourceCandidate>
): { kept: GroundedSentence } | { dropped: true } {
  const quote = sentence.source_quote;

  // Connective / interpretive prose: no source claim to ground. Keep it, but strip any
  // citations it declared without a quote (we can't verify them), so the trail stays honest.
  if (quote === null || quote.trim().length === 0) {
    return {
      kept: { text: sentence.text, citations: [], grounding: null },
    };
  }

  // Factual sentence: try to locate the quote in each cited source (then, as a fallback,
  // any provided source) so a mis-attributed but real quote still grounds to its true source.
  const citedIds = sentence.citations.filter((id) => sourcesById.has(id));
  const searchOrder = [
    ...citedIds,
    ...[...sourcesById.keys()].filter((id) => !citedIds.includes(id)),
  ];

  for (const id of searchOrder) {
    const source = sourcesById.get(id);
    if (!source) continue;
    const located = locateSpan(source.raw_text ?? "", quote);
    if (located) {
      const grounding: GroundingRef = {
        source_id: id,
        source_span: located.text,
        start: located.start,
        end: located.end,
        status: located.status,
      };
      return {
        kept: { text: sentence.text, citations: [id], grounding },
      };
    }
  }

  // A factual claim we cannot point to in any source is, by definition, unsourced. Drop it.
  return { dropped: true };
}

// Ground a full drafted section, dropping ungroundable factual sentences. Returns the
// grounded section plus how many sentences were dropped (for auditability).
function groundSection(
  section: DraftSection,
  sourcesById: ReadonlyMap<string, SourceCandidate>
): { section: GroundedSection; dropped: number } {
  const sentences: GroundedSentence[] = [];
  let dropped = 0;
  for (const s of section.sentences) {
    const result = groundSentence(s, sourcesById);
    if ("kept" in result) {
      sentences.push(result.kept);
    } else {
      dropped += 1;
    }
  }
  return {
    section: { id: section.id, heading: section.heading, sentences },
    dropped,
  };
}

// Normalize the drafted sections to the canonical five-section order, filling any the
// drafter omitted with an empty (but present) section, so the report shape is stable.
function orderSections(drafted: readonly DraftSection[]): DraftSection[] {
  const byId = new Map<SynthesisSectionId, DraftSection>();
  for (const s of drafted) {
    if (!byId.has(s.id)) byId.set(s.id, s);
  }
  return SYNTHESIS_SECTION_IDS.map(
    (id) =>
      byId.get(id) ?? {
        id,
        heading: SECTION_HEADINGS[id],
        sentences: [],
      }
  );
}

// ---------------------------------------------------------------------------
// STORM long-form backend (opt-in). STORM writes the PROSE; the deterministic
// engine still supplies every NUMBER and grounds every source claim, so STORM's
// output is held to the exact same trust invariant as the TS+Claude path and is
// mapped into the identical SynthesisReport contract.
// ---------------------------------------------------------------------------

// Hand STORM the same pre-vetted sources the engine pooled, staying inside
// PaperTrail's evidence boundary. Text goes over the bridge's stdin, never logged here.
function toStormSources(sources: readonly SourceCandidate[]): StormSource[] {
  return sources.map((s) => ({
    title: s.title ?? undefined,
    url: s.url,
    text: s.raw_text ?? "",
  }));
}

// Split STORM's article prose into sentence-granular units so each can be grounded
// independently (same granularity discipline as the TS draft). Inline [n] citation
// markers are stripped for grounding but the sentence text is kept intact.
function splitStormSentences(article: string): string[] {
  return article
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Ground ONE STORM sentence against the cached sources. STORM emits no per-sentence
// citation ids (it uses inline [n] markers), so we search every provided source for the
// sentence's quotable core. A sentence located in a source is kept as a grounded factual
// sentence citing that source; a sentence found nowhere is kept as connective prose (no
// number, no citation) — STORM never asserts an ungrounded, source-specific fact that we
// then trust. Numbers are NOT sourced from STORM; the engine facts carry every figure.
function groundStormSentence(
  text: string,
  sourcesById: ReadonlyMap<string, SourceCandidate>
): GroundedSentence {
  const quote = text.replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "").trim();
  if (quote.length > 0) {
    for (const [id, source] of sourcesById) {
      const located = locateSpan(source.raw_text ?? "", quote);
      if (located) {
        return {
          text,
          citations: [id],
          grounding: {
            source_id: id,
            source_span: located.text,
            start: located.start,
            end: located.end,
            status: located.status,
          },
        };
      }
    }
  }
  // No verbatim source support: keep as connective/interpretive prose, no citation.
  return { text, citations: [], grounding: null };
}

// The Findings/Certainty sections are built from the ENGINE facts verbatim — never from
// STORM — so STORM's prose can't introduce or reword a number. Each numeric line is
// grounded=null connective prose (it states an engine figure, not a source quote).
function engineNumberSentences(facts: EngineFacts): GroundedSentence[] {
  const line = (text: string): GroundedSentence => ({ text, citations: [], grounding: null });
  if (facts.poolable) {
    return [
      line(
        `Pooled random-effects estimate: ${facts.pooledPoint} (95% CI ${facts.pooledCiLower}–${facts.pooledCiUpper}) across k=${facts.k} ${facts.measure} studies.`
      ),
      line(`Pooled reduction: ${facts.pooledReductionPercent}%; heterogeneity I²: ${facts.iSquared}%.`),
    ];
  }
  return [line(facts.engineRationale)];
}

function engineCertaintySentences(facts: EngineFacts): GroundedSentence[] {
  const line = (text: string): GroundedSentence => ({ text, citations: [], grounding: null });
  if (facts.poolable) {
    return [
      line(`GRADE certainty: ${facts.certainty}.`),
      line(`Claim-vs-pool verdict: ${facts.verdict}.`),
    ];
  }
  return [line(facts.engineRationale)];
}

// Map STORM's {outline, article, citations} into the SAME SynthesisReport contract the
// TS path returns. STORM's grounded prose becomes the narrative (Background/Methods/
// Limitations); the engine supplies Findings/Certainty numbers. usedSources, facts and
// the grounded flag come straight from the deterministic pipeline — identical shape.
function assembleFromStorm(
  topic: string,
  facts: EngineFacts,
  pipelineResult: EvidencePipelineResult,
  storm: StormResult,
  sourcesById: ReadonlyMap<string, SourceCandidate>
): SynthesisReport {
  const groundedProse = splitStormSentences(storm.article).map((t) =>
    groundStormSentence(t, sourcesById)
  );

  // Distribute STORM's grounded narrative across the descriptive sections; the numeric
  // sections are engine-authoritative. Every section id/heading matches the TS contract.
  const half = Math.ceil(groundedProse.length / 2);
  const narrative: Record<SynthesisSectionId, GroundedSentence[]> = {
    background: groundedProse.slice(0, half),
    methods: [],
    findings: engineNumberSentences(facts),
    certainty: engineCertaintySentences(facts),
    limitations: groundedProse.slice(half),
  };

  const sections: GroundedSection[] = SYNTHESIS_SECTION_IDS.map((id) => ({
    id,
    heading: SECTION_HEADINGS[id],
    sentences: narrative[id],
  }));

  // Dropped-count parity with the TS path's auditability field: STORM sentences we could
  // not ground are demoted to connective prose rather than discarded, so none are dropped.
  return {
    topic,
    title: storm.outline[0] ?? topic,
    sections,
    facts,
    usedSources: pipelineResult.usedSources.map((s) => ({
      id: s.id,
      title: s.title,
      source_type: s.source_type,
    })),
    droppedSentenceCount: 0,
    grounded: facts.poolable,
  } satisfies SynthesisReport;
}

/**
 * Generate a long-form, fully-cited synthesis report for a topic/claim.
 *
 * Runs the deterministic evidence pipeline over the retrieved cached sources to get the
 * verified pooled numbers + GRADE certainty (the engine facts), asks Claude to draft a
 * structured Background/Methods/Findings/Certainty/Limitations review that states those
 * numbers verbatim with inline citations, then grounds every factual sentence against the
 * cached source text — dropping any sentence whose quote cannot be located. Claude writes
 * the prose; the engine supplies every number and grounds every claim.
 *
 * Retrieval and the Claude call are injectable so tests run the whole flow offline. Pure
 * orchestration: no direct DB/network I/O here. Never mutates its inputs.
 */
export async function generateSynthesisReport(
  pool: Pool,
  rawInput: SynthesisReportInput,
  opts?: { retrieve?: ReportRetriever; draft?: DraftCaller }
): Promise<SynthesisReport> {
  const input = SynthesisReportInputSchema.parse(rawInput);
  const topic = input.topic;
  const searchText = input.query ?? topic;

  const retrieve: ReportRetriever = opts?.retrieve ?? ((q) => retrieveSources(q));
  const draft: DraftCaller = opts?.draft ?? claudeDraft;

  // Retrieve once and share the candidates between the numeric pipeline (which pools
  // them) and grounding (which needs their raw_text). The evidence pipeline is fed the
  // SAME candidates via an injected retriever so its numbers and our grounding agree.
  const candidatesRaw = await retrieve(searchText);
  const candidates =
    typeof input.limit === "number" ? candidatesRaw.slice(0, input.limit) : candidatesRaw;

  const pipelineResult = await runEvidencePipeline(
    pool,
    { claim: topic, query: input.query, limit: input.limit },
    { retrieve: async () => candidates }
  );

  const facts = toEngineFacts(pipelineResult);

  // Only sources that actually contributed are grounding targets + the citation trail.
  const usedIds = new Set(pipelineResult.usedSources.map((s) => s.id));
  const usedCandidates = candidates.filter((c) => usedIds.has(c.id));
  const groundingSources = usedCandidates.length > 0 ? usedCandidates : candidates;
  const sourcesById = new Map(groundingSources.map((s) => [s.id, s]));

  // OPT-IN long-form backend: when STORM is enabled, let it write the prose from the
  // SAME pooled evidence, then ground its output exactly like the TS path and keep the
  // engine numbers authoritative. Any rejection (disabled runtime, subprocess failure,
  // timeout, unmappable output) falls through to the unchanged TS+Claude drafting below.
  if (isStormEnabled()) {
    try {
      const storm = await generateStormArticle({
        topic,
        sources: toStormSources(groundingSources),
      });
      return assembleFromStorm(topic, facts, pipelineResult, storm, sourcesById);
    } catch {
      // Fall back to the existing TS+Claude path — behavior unchanged from here down.
    }
  }

  // Claude drafts the prose from the engine facts + source snippets.
  const context = buildDraftContext(topic, facts, groundingSources);
  const rawDraft = await draft({ system: SYSTEM_PROMPT, user: context });
  // Re-validate defensively even for the default caller (schema already validated it):
  // an injected stub might not have.
  const draftValidated = SynthesisDraftSchema.parse(rawDraft);

  // Ground every section; drop ungroundable factual sentences.
  const ordered = orderSections(draftValidated.sections);
  const groundedSections: GroundedSection[] = [];
  let droppedSentenceCount = 0;
  for (const section of ordered) {
    const { section: grounded, dropped } = groundSection(section, sourcesById);
    groundedSections.push(grounded);
    droppedSentenceCount += dropped;
  }

  return {
    topic,
    title: draftValidated.title,
    sections: groundedSections,
    facts,
    usedSources: pipelineResult.usedSources.map((s) => ({
      id: s.id,
      title: s.title,
      source_type: s.source_type,
    })),
    droppedSentenceCount,
    grounded: facts.poolable,
  } satisfies SynthesisReport;
}

// Re-export the section heading map so the UI/export can label sections consistently
// with the drafter's canonical ids without re-deriving them.
export { SECTION_HEADINGS };

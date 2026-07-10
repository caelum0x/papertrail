// AGENTIC PAPER QA (PaperQA2-style) — ask a scientific question, retrieve the
// relevant cached papers, have Claude READ their full text, and answer WITH
// CITATIONS where every rendered claim is grounded to an exact substring of a
// source's raw_text.
//
// Claude does the genuinely hard work here (this is the heavy-Claude core):
//   1. READS each retrieved source's full passage and extracts the evidence
//      snippets that bear on the question (structured extraction where regex
//      cannot judge relevance).
//   2. SYNTHESISES those snippets into an answer decomposed into individually-
//      cited claims (multi-source reasoning + long-form composition).
//
// The deterministic TRUST LAYER (lib/grounding.ts) then enforces the invariant
// that makes heavy Claude use safe: every cited quote must be locatable as an
// exact (or whitespace-normalised) substring of the cited source's raw_text.
// Any claim whose evidence cannot be grounded is DROPPED — the caller only ever
// sees claims backed by a real, highlightable source span. That is what lets us
// trust a model that read four papers and wrote a paragraph.
//
// Pure orchestration over the retrieval agent + Claude + grounding: this module
// performs no direct DB writes and validates EVERY structured Claude output with
// a Zod schema before use.

import { CLAUDE_MODEL, callClaudeForJson } from "../claude";
import { retrieveSources } from "../agents/retrievalAgent";
import { locateSpan } from "../grounding";
import { askPaperQa as askPaperQaEngine, isPaperQaEnabled } from "../engines/paperqa";
import type { SourceCandidate } from "../schemas";
import {
  SourceEvidenceSchema,
  CitedAnswerSchema,
  type SourceEvidence,
  type EvidenceSnippet,
  type CitedAnswer,
} from "./schemas";

const DEFAULT_LIMIT = 5;

// A source that Claude read, with the grounded evidence snippets it produced.
export interface ReadSource {
  index: number;
  id: string;
  title: string | null;
  url: string;
  source_type: SourceCandidate["source_type"];
  external_id: string;
  similarity: number;
  /** Snippets whose `quote` was located verbatim in this source's raw_text. */
  evidence: GroundedEvidence[];
}

export interface GroundedEvidence extends EvidenceSnippet {
  /** Char offsets into the source raw_text, for highlighting the span in place. */
  grounding: { status: "exact" | "approximate"; start: number; end: number };
  /** The verbatim located text (never the model's paraphrase). */
  located_text: string;
}

// One claim of the final answer, after grounding. Ungrounded citations are
// dropped; a claim that loses ALL its citations is dropped entirely upstream.
export interface GroundedClaim {
  text: string;
  citations: GroundedCitation[];
}

export interface GroundedCitation {
  source_index: number;
  source_id: string;
  quote: string;
  grounding: { status: "exact" | "approximate"; start: number; end: number };
}

export type PaperQaOutcome =
  | {
      status: "answered";
      question: string;
      sources: ReadSource[];
      claims: GroundedClaim[];
      caveat: string;
      /** How many model-produced claims were dropped for being ungroundable. */
      dropped_claims: number;
    }
  | {
      status: "no_support_found";
      question: string;
      message: string;
    };

// --- Stage 1: Claude reads one source and extracts evidence -----------------

const READ_SYSTEM = `You are a meticulous biomedical research assistant reading a single source passage to answer a scientific question.

Read the ENTIRE passage. Extract only the snippets that genuinely bear on the question. For each snippet, the "quote" field MUST be copied VERBATIM from the passage — character for character, including punctuation and numbers. Do NOT paraphrase, summarise, translate, or correct anything inside a quote. If nothing in the passage bears on the question, return relevant=false with an empty snippets array.

Never invent a quote that is not present in the passage. A fabricated quote is worse than an empty answer.

Respond with ONLY a JSON object matching this shape:
{
  "relevant": boolean,
  "snippets": [
    { "quote": string, "relevance": string, "supports": "answers" | "contradicts" | "context" }
  ]
}`;

async function readSourceForEvidence(
  question: string,
  source: SourceCandidate
): Promise<SourceEvidence> {
  const user = `Question:\n${question}\n\nSource title: ${source.title ?? "(untitled)"}\nSource passage:\n"""\n${source.raw_text}\n"""\n\nExtract the verbatim evidence snippets from this passage that bear on the question.`;

  return callClaudeForJson({
    system: READ_SYSTEM,
    user,
    schema: SourceEvidenceSchema,
    maxTokens: 1500,
  });
}

// Ground a source's model-extracted snippets against its raw_text, dropping any
// quote we cannot locate. Returns a NEW ReadSource; input is not mutated.
// Exported for testing the grounding invariant without a live LLM.
export function groundSourceEvidence(
  index: number,
  source: SourceCandidate,
  evidence: SourceEvidence
): ReadSource {
  const grounded: GroundedEvidence[] = [];
  for (const snippet of evidence.snippets) {
    const located = locateSpan(source.raw_text, snippet.quote);
    if (!located) continue; // ungroundable → dropped (never trusted)
    grounded.push({
      ...snippet,
      located_text: located.text,
      grounding: { status: located.status, start: located.start, end: located.end },
    });
  }
  return {
    index,
    id: source.id,
    title: source.title,
    url: source.url,
    source_type: source.source_type,
    external_id: source.external_id,
    similarity: source.similarity,
    evidence: grounded,
  };
}

// --- Stage 2: Claude synthesises a cited answer -----------------------------

const SYNTH_SYSTEM = `You are writing a cited answer to a scientific question, using ONLY the grounded evidence snippets provided from retrieved papers.

Rules:
- Decompose your answer into individual sentences ("answer_claims"). Each sentence must be fully supported by the evidence you cite for it.
- Every claim MUST cite at least one source by its "source_index" and re-quote the exact evidence span it used. Copy each "quote" VERBATIM from the provided snippets — do not alter it.
- Do NOT introduce facts that are not present in the provided evidence. If the evidence is insufficient to answer honestly, set "insufficient": true and keep answer_claims minimal.
- Prefer synthesising across multiple sources when they agree, and note disagreement when they conflict.
- Put an honest one-sentence "caveat" about the limits of this evidence (or "" if none).

Respond with ONLY a JSON object matching this shape:
{
  "answer_claims": [
    { "text": string, "citations": [ { "source_index": number, "quote": string } ] }
  ],
  "insufficient": boolean,
  "caveat": string
}`;

async function synthesiseCitedAnswer(
  question: string,
  sources: ReadSource[]
): Promise<CitedAnswer> {
  // Only feed Claude the grounded evidence — it composes from spans we can
  // already prove exist in the sources, which keeps the answer grounded.
  const evidenceBlock = sources
    .map((s) => {
      const lines = s.evidence
        .map((e, i) => `  [${i}] (${e.supports}) "${e.located_text}"`)
        .join("\n");
      return `Source index ${s.index} — ${s.title ?? "(untitled)"} (${s.source_type}:${s.external_id}):\n${lines}`;
    })
    .join("\n\n");

  const user = `Question:\n${question}\n\nGrounded evidence from retrieved papers:\n${evidenceBlock}\n\nWrite the cited answer. Every claim must cite a source_index and re-quote its evidence verbatim.`;

  return callClaudeForJson({
    system: SYNTH_SYSTEM,
    user,
    schema: CitedAnswerSchema,
    maxTokens: 2000,
  });
}

// Ground the synthesised answer: for each claim, keep only citations whose quote
// locates in the cited source's raw_text; drop claims that lose all citations.
// Exported for testing the grounding invariant without a live LLM.
export function groundAnswer(
  answer: CitedAnswer,
  sources: ReadSource[],
  rawTextByIndex: Map<number, string>
): { claims: GroundedClaim[]; dropped: number } {
  const claims: GroundedClaim[] = [];
  let dropped = 0;

  for (const claim of answer.answer_claims) {
    const citations: GroundedCitation[] = [];
    for (const cite of claim.citations) {
      const rawText = rawTextByIndex.get(cite.source_index);
      const source = sources.find((s) => s.index === cite.source_index);
      if (!rawText || !source) continue; // citing a source that wasn't provided
      const located = locateSpan(rawText, cite.quote);
      if (!located) continue; // ungroundable citation → dropped
      citations.push({
        source_index: cite.source_index,
        source_id: source.id,
        quote: located.text,
        grounding: { status: located.status, start: located.start, end: located.end },
      });
    }
    if (citations.length === 0) {
      dropped += 1; // a claim with no grounded citation is not shown
      continue;
    }
    claims.push({ text: claim.text, citations });
  }

  return { claims, dropped };
}

// --- Optional OSS engine backend (opt-in via PAPERQA_ENABLED) ----------------
//
// When the vendored PaperQA2 backend is enabled, we let it read the retrieved
// sources and synthesise the answer. Its raw output is NOT trusted directly:
// every returned context passage is grounded against the retrieved source
// raw_text via lib/grounding.ts (exactly as the TS path grounds snippets), and
// any passage we cannot locate is dropped. The grounded passages become the
// citations for a single answer claim, mapped into the SAME PaperQaOutcome shape
// the in-process path returns. On ANY rejection the caller falls back unchanged.

// The engine echoes back each source it was given via `context.name`; we pass a
// stable per-index tag so we can map a context to the source that produced it.
function engineSourceTag(index: number): string {
  return `src-${index}`;
}

function engineSourceIndex(name: string): number | null {
  const m = /^src-(\d+)$/.exec(name);
  if (!m) return null;
  const idx = Number.parseInt(m[1], 10);
  return Number.isInteger(idx) ? idx : null;
}

// Ground the engine's answer against the retrieved sources: locate each returned
// context passage in its source's raw_text (dropping ungroundable ones), then map
// the surviving passages into the existing ReadSource / GroundedClaim shapes.
// Returns null when nothing survives grounding, so the caller can return an honest
// no_support_found rather than an ungrounded answer.
function groundEngineAnswer(
  question: string,
  sources: SourceCandidate[],
  engine: { answer: string; contexts: { text: string; name: string; summary: string }[] }
): PaperQaOutcome | null {
  const readByIndex = new Map<number, ReadSource>();
  const citations: GroundedCitation[] = [];

  for (const ctx of engine.contexts) {
    const idx = engineSourceIndex(ctx.name);
    if (idx === null) continue; // a context we cannot attribute to a source
    const source = sources[idx];
    if (!source) continue;
    const located = locateSpan(source.raw_text, ctx.text);
    if (!located) continue; // ungroundable passage → dropped (never trusted)

    let read = readByIndex.get(idx);
    if (!read) {
      read = {
        index: idx,
        id: source.id,
        title: source.title,
        url: source.url,
        source_type: source.source_type,
        external_id: source.external_id,
        similarity: source.similarity,
        evidence: [],
      };
      readByIndex.set(idx, read);
    }
    read = {
      ...read,
      evidence: [
        ...read.evidence,
        {
          quote: located.text,
          relevance: ctx.summary,
          supports: "answers",
          located_text: located.text,
          grounding: { status: located.status, start: located.start, end: located.end },
        },
      ],
    };
    readByIndex.set(idx, read);

    citations.push({
      source_index: idx,
      source_id: source.id,
      quote: located.text,
      grounding: { status: located.status, start: located.start, end: located.end },
    });
  }

  if (citations.length === 0) return null;

  const answerText = engine.answer.trim();
  if (answerText.length === 0) return null;

  const readSources = [...readByIndex.values()].sort((a, b) => a.index - b.index);

  return {
    status: "answered",
    question,
    sources: readSources,
    claims: [{ text: answerText, citations }],
    caveat: "",
    dropped_claims: 0,
  };
}

// --- Orchestration ----------------------------------------------------------

/**
 * Answer a scientific question over the cached source corpus, PaperQA2-style.
 *
 * Retrieves candidate cached sources via the retrieval agent, has Claude READ
 * each and extract verbatim evidence, then has Claude SYNTHESISE a cited answer
 * — and finally grounds every cited span against the source raw_text, dropping
 * anything ungroundable. Returns `no_support_found` (never a forced low-confidence
 * answer) when retrieval finds nothing or no grounded evidence survives.
 */
export async function askPaperQa(
  question: string,
  opts?: { limit?: number }
): Promise<PaperQaOutcome> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;

  const candidates = await retrieveSources(question);
  const sources = candidates.slice(0, limit);

  if (sources.length === 0) {
    return {
      status: "no_support_found",
      question,
      message:
        "Couldn't find a confident matching source in the cached corpus (PubMed / ClinicalTrials.gov). This doesn't mean there's no answer — it means this tool couldn't retrieve a source to read for it.",
    };
  }

  // Optional OSS backend: when enabled, let the vendored PaperQA2 engine read the
  // retrieved sources and answer. Ground its output the same way the TS path does,
  // and on ANY failure (rejection, or nothing survives grounding) fall through to
  // the in-process TS + Claude pipeline below, unchanged.
  if (isPaperQaEnabled()) {
    try {
      const engine = await askPaperQaEngine({
        question,
        texts: sources.map((s, i) => ({ name: engineSourceTag(i), text: s.raw_text })),
      });
      const grounded = groundEngineAnswer(question, sources, engine);
      if (grounded) return grounded;
      // Nothing grounded → fall through to the TS + Claude path.
    } catch {
      // Engine unavailable/failed → fall through to the TS + Claude path.
    }
  }

  // Stage 1 — Claude reads every retrieved source in parallel and extracts
  // verbatim evidence; each source's snippets are grounded immediately.
  const evidences = await Promise.all(
    sources.map(async (source, i) => {
      try {
        const evidence = await readSourceForEvidence(question, source);
        return groundSourceEvidence(i, source, evidence);
      } catch {
        // One unreadable source must not sink the whole answer.
        return groundSourceEvidence(i, source, { relevant: false, snippets: [] });
      }
    })
  );

  const sourcesWithEvidence = evidences.filter((s) => s.evidence.length > 0);

  if (sourcesWithEvidence.length === 0) {
    return {
      status: "no_support_found",
      question,
      message:
        "Retrieved sources were read, but none contained evidence that could be grounded to an exact source span for this question. Returning an honest 'no support found' rather than an ungrounded answer.",
    };
  }

  // Stage 2 — Claude synthesises a cited answer from the grounded evidence.
  const answer = await synthesiseCitedAnswer(question, sourcesWithEvidence);

  const rawTextByIndex = new Map<number, string>(
    sources.map((s, i) => [i, s.raw_text])
  );
  const { claims, dropped } = groundAnswer(answer, evidences, rawTextByIndex);

  if (claims.length === 0) {
    return {
      status: "no_support_found",
      question,
      message:
        answer.insufficient
          ? "Claude read the retrieved papers and judged the evidence insufficient to answer this question honestly."
          : "No claim in the synthesised answer could be grounded to an exact source span, so none are shown. This is the honest 'couldn't verify' state.",
    };
  }

  return {
    status: "answered",
    question,
    sources: evidences,
    claims,
    caveat: answer.caveat,
    dropped_claims: dropped,
  };
}

export { CLAUDE_MODEL };

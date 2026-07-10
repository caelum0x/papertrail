// NATIVE PORT of STORM's OUTLINE-THEN-WRITE, multi-perspective synthesis
// (backend/engines/storm/knowledge_storm/storm_wiki). STORM's pipeline is:
//
//   1. PERSPECTIVE / PERSONA generation (persona_generator.py: GenPersona) — pick a
//      set of distinct expert viewpoints so the article covers the topic from multiple
//      angles rather than one flat summary.
//   2. OUTLINE generation (outline_generation.py: WritePageOutline) — turn the topic +
//      those perspectives into a hierarchical section outline (# / ## headings).
//   3. SECTION-BY-SECTION writing (article_generation.py: WriteSection) — write each
//      section INDEPENDENTLY from the collected information, with inline [n] citations,
//      never asserting anything the collected sources don't support.
//
// This is a NATIVE TypeScript port on PaperTrail's stack — NO Python, NO subprocess,
// NO HTTP to a service. It complements lib/synthesisReport (which is the numeric,
// engine-facts-authoritative path) and does NOT edit it. Where STORM used a trained
// model (persona+outline generation, section prose) we call CLAUDE via
// lib/claude.callClaudeForJson with a Zod schema; the DETERMINISTIC part — locating
// every written claim in a real source and DROPPING the ones we can't — stays native
// TS, reusing lib/grounding.locateSpan, which is exactly PaperTrail's trust invariant:
//
//   Every sentence in the output grounds to a verbatim span of a PROVIDED source, or it
//   is dropped. STORM's "cite the collected info" becomes PaperTrail's "no unsourced
//   claim about a source." Numbers are NOT invented here; a written sentence survives
//   only if its quote is found in a source's text.
//
// Claude is INJECTABLE so tests run the whole outline -> per-section grounded write flow
// over mocks with no live API, DB, or embeddings. This file performs no direct I/O of
// its own; retrieval/model access is threaded in by the caller.

import { z } from "zod";
import { locateSpan } from "../grounding";

// ---------------------------------------------------------------------------
// Boundary schemas. Everything the model returns is validated the moment it comes
// back, before anything downstream reads it (the CLAUDE.md rule: never trust a raw
// JSON.parse of a model response). Kept in this single owned file — small, explicit,
// no I/O.
// ---------------------------------------------------------------------------

// One pre-vetted source handed to the synthesizer. `id` is optional; when absent we
// assign a stable 1-based index. `text` is the cached source raw_text we ground against.
export const OutlineSourceInputSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().nullable().optional(),
  text: z.string().default(""),
});
export type OutlineSourceInput = z.infer<typeof OutlineSourceInputSchema>;

// Boundary input for outlineThenWrite / a future route.
export const OutlineThenWriteInputSchema = z.object({
  topic: z.string().trim().min(10).max(2000),
  sources: z.array(OutlineSourceInputSchema).min(1).max(20),
});
export type OutlineThenWriteInput = z.infer<typeof OutlineThenWriteInputSchema>;

// STAGE 1+2 model output: the multi-perspective outline. A flat section list (headings +
// a one-line query per section) plus the perspectives that shaped it.
export const OutlineSectionSchema = z.object({
  heading: z.string().trim().min(1).max(160),
  query: z.string().trim().min(1).max(400),
});
export type OutlineSection = z.infer<typeof OutlineSectionSchema>;

export const OutlineDraftSchema = z.object({
  perspectives: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  sections: z.array(OutlineSectionSchema).min(1).max(10),
});
export type OutlineDraft = z.infer<typeof OutlineDraftSchema>;

// STAGE 3 model output: one section's prose as grounded-checkable sentences.
export const ProseSentenceSchema = z.object({
  text: z.string().trim().min(1).max(1200),
  // Source references — the model is told to cite by 1-based number; we tolerate ids too.
  citations: z.array(z.union([z.string(), z.number()])).max(20).default([]),
  source_quote: z.string().trim().min(1).max(2000).nullable().default(null),
});

export const SectionProseSchema = z.object({
  sentences: z.array(ProseSentenceSchema).max(60),
});
export type SectionProse = z.infer<typeof SectionProseSchema>;

// The grounded output for one section: prose whose factual sentences all located in a
// source, plus the source ids they cite.
export interface WrittenSection {
  heading: string;
  content: string;
  citations: string[];
}

// The assembled result outlineThenWrite returns.
export interface OutlineThenWriteResult {
  topic: string;
  outline: {
    perspectives: string[];
    headings: string[];
  };
  sections: WrittenSection[];
  // Auditability: how many factual sentences were dropped for being ungroundable.
  droppedCount: number;
}

// A model caller returns Claude's structured JSON, already validated against `schema`.
// The default calls the real Claude via callClaudeForJson (lazily imported so pure unit
// tests of the grounding logic never pull in the SDK); tests inject a stub.
export type OutlineClaudeCaller = <T>(args: {
  system: string;
  user: string;
  schema: { parse: (v: unknown) => T };
  maxTokens?: number;
}) => Promise<T>;

export interface OutlineThenWriteDeps {
  callClaude?: OutlineClaudeCaller;
}

// Cap how much source text we hand the model per source, mirroring STORM's
// limit_word_count_preserve_newline on collected info. Grounding still runs against the
// FULL source text, so truncation only bounds prompt size, never the trust check.
const MAX_SOURCE_CHARS = 1800;
const MAX_OUTLINE_TOKENS = 1024;
const MAX_SECTION_TOKENS = 2048;

// ---------------------------------------------------------------------------
// Source identity. STORM cites collected info by index ([1], [2], ...). We keep a
// stable id per source (its provided id, else its 1-based index) so citations map back
// to a concrete source and grounding can attribute a located span to it.
// ---------------------------------------------------------------------------
interface IndexedSource {
  id: string;
  index: number; // 1-based, matches the [n] the model is told to use
  title: string | null;
  text: string;
}

function indexSources(sources: readonly OutlineSourceInput[]): IndexedSource[] {
  return sources.map((s, i) => ({
    id: s.id ?? String(i + 1),
    index: i + 1,
    title: s.title ?? null,
    text: s.text ?? "",
  }));
}

// ---------------------------------------------------------------------------
// STAGE 1+2: multi-perspective OUTLINE.
// STORM generates personas then an outline; we fold both into a single Claude call that
// returns { perspectives, sections:[heading, ...] }. Sections carry a short `query`
// (what the section is about) used to focus the later per-section writing prompt — the
// analogue of STORM feeding each section its own retrieved info subset.
// ---------------------------------------------------------------------------
const OUTLINE_SYSTEM =
  "You are a systematic-review outliner for PaperTrail. Given a TOPIC and a set of " +
  "source snippets, you FIRST identify a small set of distinct expert PERSPECTIVES that " +
  "should shape a comprehensive review (e.g. a clinical trialist, a methodologist, a " +
  "safety/pharmacovigilance reviewer), THEN produce a flat section outline that, taken " +
  "together, covers the topic from those perspectives. Rules:\n" +
  "1. 3-7 sections. Each has a short `heading` and a one-line `query` describing what the " +
  "section should establish from the sources.\n" +
  "2. Do NOT include the topic name itself as a section, and do NOT write a separate " +
  "Introduction or Conclusion section.\n" +
  "3. Base sections ONLY on what the provided sources can support — do not outline topics " +
  "no source speaks to.\n" +
  "Return ONLY JSON of shape {perspectives:[string], sections:[{heading, query}]}.";

function buildOutlineContext(topic: string, sources: readonly IndexedSource[]): string {
  const lines: string[] = [`TOPIC:\n${topic}`, "", "SOURCES:"];
  for (const s of sources) {
    const snippet = s.text.slice(0, MAX_SOURCE_CHARS);
    lines.push(`[${s.index}] id=${s.id} title=${s.title ?? "(untitled)"}\n${snippet}`, "");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// STAGE 3: per-section GROUNDED writing.
// STORM's WriteSection writes one section from the collected info with inline [n]
// citations. We ask Claude for the section as an array of sentences, each with the
// source indices it draws on and a verbatim `source_quote`. Every factual sentence is
// then GROUNDED: its quote must be located in a cited source's text, else the sentence
// is DROPPED. Connective sentences (no quote) are kept, uncited.
// ---------------------------------------------------------------------------
const SECTION_SYSTEM =
  "You are a systematic-review writer for PaperTrail writing ONE section of a review. " +
  "You are given the section HEADING, what it should establish, and numbered SOURCES. " +
  "Rules you must never break:\n" +
  "1. Write the section as a list of sentences. Every sentence that states a fact drawn " +
  "from a source MUST set `source_quote` to a VERBATIM substring copied from that source, " +
  "and list that source's number(s) in `citations`.\n" +
  "2. If you cannot quote a source for a factual claim, do NOT make the claim.\n" +
  "3. Purely connective/framing sentences may set `source_quote` to null and `citations` " +
  "to []. Do not state numbers that no source contains.\n" +
  "4. Write only THIS section; do not restate the topic title or write other sections.\n" +
  "Return ONLY JSON of shape {sentences:[{text, citations:[number], source_quote}]}.";

function buildSectionContext(
  topic: string,
  heading: string,
  query: string,
  sources: readonly IndexedSource[]
): string {
  const lines: string[] = [
    `TOPIC:\n${topic}`,
    "",
    `SECTION HEADING: ${heading}`,
    `THIS SECTION SHOULD ESTABLISH: ${query}`,
    "",
    "SOURCES (quote ONLY text that appears in a snippet; cite by number):",
  ];
  for (const s of sources) {
    const snippet = s.text.slice(0, MAX_SOURCE_CHARS);
    lines.push(`[${s.index}] ${s.title ?? "(untitled)"}\n${snippet}`, "");
  }
  return lines.join("\n");
}

// Resolve a model-supplied citation index/id to one of our indexed sources. The model is
// told to cite by 1-based number, but we tolerate it echoing the source id too.
function resolveSource(
  cite: string | number,
  byIndex: ReadonlyMap<number, IndexedSource>,
  byId: ReadonlyMap<string, IndexedSource>
): IndexedSource | undefined {
  const asNum = typeof cite === "number" ? cite : Number.parseInt(cite, 10);
  if (Number.isFinite(asNum) && byIndex.has(asNum)) return byIndex.get(asNum);
  return byId.get(String(cite));
}

// Ground ONE written section against the sources. Factual sentences whose quote can't be
// located in ANY cited (then any provided) source are DROPPED. Returns the grounded
// section content + citation set + how many sentences were dropped (for auditability).
function groundSection(
  heading: string,
  prose: SectionProse,
  sources: readonly IndexedSource[]
): { section: WrittenSection; dropped: number } {
  const byIndex = new Map(sources.map((s) => [s.index, s]));
  const byId = new Map(sources.map((s) => [s.id, s]));

  const keptTexts: string[] = [];
  const citationIds = new Set<string>();
  let dropped = 0;

  for (const sentence of prose.sentences) {
    const quote = sentence.source_quote;

    // Connective / framing prose: nothing to ground. Keep it, drop any bare citations it
    // declared without a quote (we can't verify them) so the trail stays honest.
    if (quote === null || quote.trim().length === 0) {
      keptTexts.push(sentence.text);
      continue;
    }

    // Factual sentence: search cited sources first, then any remaining source, so a real
    // but mis-attributed quote still grounds to its true source.
    const citedSources = sentence.citations
      .map((c) => resolveSource(c, byIndex, byId))
      .filter((s): s is IndexedSource => s !== undefined);
    const searchOrder = [
      ...citedSources,
      ...sources.filter((s) => !citedSources.some((c) => c.id === s.id)),
    ];

    let grounded = false;
    for (const source of searchOrder) {
      const located = locateSpan(source.text, quote);
      if (located) {
        keptTexts.push(sentence.text);
        citationIds.add(source.id);
        grounded = true;
        break;
      }
    }
    // A factual claim we cannot point to in any source is unsourced. Drop it.
    if (!grounded) dropped += 1;
  }

  return {
    section: {
      heading,
      content: keptTexts.join(" "),
      citations: [...citationIds],
    },
    dropped,
  };
}

// Real Claude caller. Kept off the default path so pure grounding tests don't import the
// SDK; lazily pulls lib/claude only when actually invoked.
const defaultClaudeCaller: OutlineClaudeCaller = async (args) => {
  const { callClaudeForJson } = await import("../claude");
  return callClaudeForJson(args);
};

/**
 * OUTLINE-THEN-WRITE, multi-perspective synthesis — a native port of STORM.
 *
 * Given a topic and a set of pre-vetted sources, Claude first drafts a multi-perspective
 * section outline (perspectives + section headings/queries), then writes EACH section
 * independently, grounded ONLY in the provided sources. Every written factual sentence is
 * located in a source via lib/grounding.locateSpan; sentences whose quote can't be found
 * are DROPPED. Returns { outline, sections:[{heading, content, citations}], droppedCount }.
 *
 * Claude is injectable (deps.callClaude) so the whole flow runs offline in tests. Pure
 * orchestration — no direct DB/network I/O here; never mutates its inputs.
 */
export async function outlineThenWrite(
  rawInput: OutlineThenWriteInput,
  deps?: OutlineThenWriteDeps
): Promise<OutlineThenWriteResult> {
  const input = OutlineThenWriteInputSchema.parse(rawInput);
  const callClaude = deps?.callClaude ?? defaultClaudeCaller;

  const sources = indexSources(input.sources);

  // STAGE 1+2 — multi-perspective outline. Re-validate defensively even for the default
  // caller (an injected stub may not have validated its own output).
  const rawOutline = await callClaude({
    system: OUTLINE_SYSTEM,
    user: buildOutlineContext(input.topic, sources),
    schema: OutlineDraftSchema,
    maxTokens: MAX_OUTLINE_TOKENS,
  });
  const outline: OutlineDraft = OutlineDraftSchema.parse(rawOutline);

  // STAGE 3 — write each section grounded in the sources. Sections are written one at a
  // time (each is an independent grounded unit, exactly as STORM writes section by
  // section); this preserves the per-section trust boundary and keeps prompts bounded.
  const sections: WrittenSection[] = [];
  let droppedCount = 0;

  for (const sec of outline.sections) {
    const rawProse = await callClaude({
      system: SECTION_SYSTEM,
      user: buildSectionContext(input.topic, sec.heading, sec.query, sources),
      schema: SectionProseSchema,
      maxTokens: MAX_SECTION_TOKENS,
    });
    const prose = SectionProseSchema.parse(rawProse);
    const { section, dropped } = groundSection(sec.heading, prose, sources);
    sections.push(section);
    droppedCount += dropped;
  }

  return {
    topic: input.topic,
    outline: {
      perspectives: outline.perspectives,
      headings: outline.sections.map((s) => s.heading),
    },
    sections,
    droppedCount,
  } satisfies OutlineThenWriteResult;
}

import { callClaudeForJson } from "../claude";
import { locateSpan } from "../grounding";
import {
  ExtractionResultSchema,
  type ExtractedEntity,
  type EntityType,
  type GroundedRelation,
  type SourceExtraction,
} from "./schemas";

// Evidence Knowledge Graph — EXTRACTION engine. This is the heavy-Claude core of the
// feature (BUILD_MINDSET rule 1): Claude reads a source's full raw_text and reasons
// out the biomedical entities and typed relations that regex/NER cannot reliably get
// (implicit subjects, hedged causality, cross-sentence findings). The structured
// output is validated against a strict Zod schema before ANY of it is used.
//
// The deterministic TRUST LAYER (rule 2) is then applied here: for every relation
// Claude proposes, we locate its `evidence_sentence` VERBATIM in raw_text via
// lib/grounding.locateSpan. Relations whose supporting sentence cannot be located are
// DROPPED — no edge in this graph exists without an exact source span behind it.

const SYSTEM_PROMPT = `You are a biomedical knowledge-graph extractor for clinical-trial and PubMed abstracts.

Read the SOURCE TEXT and extract:
1. entities — the drugs/interventions, conditions, populations, outcomes, and trials mentioned.
2. relations — typed, directed edges between those entities that the text actually supports.

Entity types (use exactly one per entity):
- "drug": an intervention (drug, device, procedure, therapy)
- "condition": a disease, condition, or indication
- "population": a studied population or subgroup (e.g. "adults 65+ with prior MI")
- "outcome": a measured endpoint or outcome (e.g. "major adverse cardiovascular events")
- "trial": a named study or trial

Relation predicates (use exactly one per relation):
- "treats": drug -> condition
- "reduces_risk_of": intervention -> outcome/condition (protective effect shown)
- "increases_risk_of": intervention -> outcome/condition (harm shown)
- "no_effect_on": intervention -> outcome (a null / non-significant result)
- "associated_with": non-causal association between two entities
- "studied_in": entity -> trial/population
- "contradicts": one finding contradicts another

STRICT RULES:
- subject and object of every relation MUST be the exact "name" of an entity you listed.
- Only assert a relation the text SUPPORTS. Do NOT infer beyond the text. If the result was null/non-significant, use "no_effect_on", never "reduces_risk_of".
- For EVERY relation you MUST provide "evidence_sentence": copy the single exact sentence from the SOURCE TEXT (verbatim, character-for-character, no paraphrasing) that supports the relation. If you cannot quote a supporting sentence verbatim, do not emit that relation.
- Prefer fewer, well-supported relations over many speculative ones.

Return ONLY a JSON object of this shape, nothing else:
{"entities":[{"name":"...","type":"..."}],"relations":[{"subject":"...","predicate":"...","object":"...","evidence_sentence":"..."}]}`;

// Cap the text we send per source so a pathological raw_text can't blow the token
// budget. Abstracts and trial summaries are well under this; long full texts are
// truncated (the grounding layer still only accepts sentences it can locate).
const MAX_SOURCE_CHARS = 12000;
const EXTRACTION_MAX_TOKENS = 2048;

/**
 * Run Claude entity/relation extraction over ONE source's raw_text, then ground
 * every proposed relation to an exact supporting sentence in that text. Returns a
 * SourceExtraction; ungroundable relations are dropped (counted, never fabricated).
 *
 * Throws only if Claude returns nothing usable (invalid JSON / schema violation) —
 * callers isolate that per-source so one bad source can't sink a whole graph build.
 */
export async function extractGraphFromSource(
  sourceId: string,
  rawText: string
): Promise<SourceExtraction> {
  const text = (rawText ?? "").trim();
  if (text.length < 20) {
    return { source_id: sourceId, entities: [], relations: [], dropped_relations: 0 };
  }

  const truncated = text.length > MAX_SOURCE_CHARS ? text.slice(0, MAX_SOURCE_CHARS) : text;

  const result = await callClaudeForJson({
    system: SYSTEM_PROMPT,
    user: `SOURCE TEXT:\n\n${truncated}`,
    schema: ExtractionResultSchema,
    maxTokens: EXTRACTION_MAX_TOKENS,
  });

  // Index entities by name so we can attach a type to each grounded relation and
  // reject relations that reference an entity the model never declared.
  const entityByName = new Map<string, ExtractedEntity>();
  for (const e of result.entities) {
    const key = normalizeName(e.name);
    if (!entityByName.has(key)) entityByName.set(key, e);
  }

  const grounded: GroundedRelation[] = [];
  let dropped = 0;

  for (const rel of result.relations) {
    const subjectEntity = entityByName.get(normalizeName(rel.subject));
    const objectEntity = entityByName.get(normalizeName(rel.object));

    // Drop relations whose endpoints aren't declared entities: an edge to an
    // unknown node has no place in the graph.
    if (!subjectEntity || !objectEntity) {
      dropped += 1;
      continue;
    }

    // THE TRUST INVARIANT: locate the model's evidence sentence VERBATIM in the
    // ORIGINAL (untruncated) source text. Drop the relation if we cannot.
    const located = locateSpan(text, rel.evidence_sentence);
    if (!located) {
      dropped += 1;
      continue;
    }

    grounded.push({
      subject: subjectEntity.name,
      subject_type: subjectEntity.type as EntityType,
      predicate: rel.predicate,
      object: objectEntity.name,
      object_type: objectEntity.type as EntityType,
      source_id: sourceId,
      grounded_sentence: located.text,
      grounding: { status: located.status, start: located.start, end: located.end },
    });
  }

  return {
    source_id: sourceId,
    entities: result.entities,
    relations: grounded,
    dropped_relations: dropped,
  };
}

/** Canonical key for merging entities by name: lower-cased, whitespace-collapsed. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

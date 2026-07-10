// BIOMEDICAL NER + ENTITY LINKING — a native TypeScript port of scispaCy
// (backend/engines/scispacy).
//
// scispaCy's pipeline: a trained NER model tags biomedical mentions -> an
// AbbreviationDetector (Schwartz & Hearst 2003, abbreviation.py) resolves short forms
// to long forms -> an EntityLinker (linking.py) maps each mention string to a KB concept
// id using a KnowledgeBase (linking_utils.py) whose two views are `alias_to_cuis`
// (surface form -> candidate concept ids) and `cui_to_entity` (concept id -> canonical
// name / aliases / type). scispaCy links a mention only when a candidate clears a
// similarity threshold; otherwise it leaves the mention unlinked (empty kb_ents).
//
// This port keeps EXACTLY that architecture and this repo's convention that only the
// trained-model step goes to Claude:
//   1. NER (the trained model) -> CLAUDE proposes candidate mentions { text, type }.
//      This is the ONLY LLM step; its output is validated against a Zod schema at the
//      trust boundary (never JSON.parse a model response without a schema).
//   2. ABBREVIATION RESOLUTION -> native Schwartz-Hearst port (findAbbreviations) over
//      the raw input, so a short-form mention links via its long form (as scispaCy does
//      when resolve_abbreviations is on).
//   3. GROUNDING -> lib/grounding locateSpan places each mention verbatim in the input
//      (exact offsets); an ungroundable mention is DROPPED (PaperTrail never asserts an
//      unsourced span).
//   4. LINKING -> a DETERMINISTIC native linker maps each grounded mention to a
//      normalized concept id via the in-code BIOMEDICAL_DICTIONARY. A candidate never
//      comes from the model; the score is a string-match number, not an LLM number.
//
// Every external dependency (Claude) is injected via a deps object so the whole thing
// runs OFFLINE against mocks in tests. On any failure the pipeline degrades to an
// HONEST empty result rather than fabricating entities.

import { locateSpan, type SpanGroundingStatus } from "../grounding";
import { callClaudeForJson } from "../claude";
import {
  NerExtractionSchema,
  type EntityLink,
  type EntityType,
  type LinkedEntity,
  type NerResult,
  type RawMention,
} from "./schemas";

// ---------------------------------------------------------------------------
// The in-code KNOWLEDGE BASE — a documented dictionary of common biomedical entities,
// standing in for scispaCy's downloaded UMLS/MeSH KB (which is a multi-GB S3 artifact we
// deliberately do NOT ship). Each concept mirrors scispaCy's `Entity` NamedTuple
// (concept_id / canonical_name / aliases / type). Ids are real UMLS CUIs / MeSH ids so a
// linked entity is auditable against public terminologies. Extend as coverage needs
// grow — the linker (below) is data-driven and needs no code change to add a concept.
// ---------------------------------------------------------------------------

export interface KbConcept {
  /** The concept id — a UMLS CUI ("C…") or MeSH id ("D…"), scispaCy's concept_id. */
  conceptId: string;
  /** Preferred display name — scispaCy's canonical_name. */
  canonicalName: string;
  /** Surface-form synonyms (canonical name is added automatically) — scispaCy aliases. */
  aliases: readonly string[];
  /** Coarse type, constraining which mentions may link to this concept. */
  type: EntityType;
}

export const BIOMEDICAL_DICTIONARY: readonly KbConcept[] = [
  // --- Diseases ---
  {
    conceptId: "C0002395",
    canonicalName: "Alzheimer's Disease",
    aliases: ["Alzheimer disease", "Alzheimers", "AD", "Alzheimer's", "senile dementia"],
    type: "disease",
  },
  {
    conceptId: "C0011860",
    canonicalName: "Type 2 Diabetes Mellitus",
    aliases: ["type 2 diabetes", "T2DM", "type II diabetes", "diabetes mellitus type 2", "NIDDM"],
    type: "disease",
  },
  {
    conceptId: "C0027051",
    canonicalName: "Myocardial Infarction",
    aliases: ["heart attack", "MI", "acute myocardial infarction", "AMI"],
    type: "disease",
  },
  {
    conceptId: "C0038454",
    canonicalName: "Stroke",
    aliases: ["cerebrovascular accident", "CVA", "cerebral infarction", "brain attack"],
    type: "disease",
  },
  {
    conceptId: "C0018801",
    canonicalName: "Heart Failure",
    aliases: ["cardiac failure", "congestive heart failure", "CHF", "HF"],
    type: "disease",
  },
  {
    conceptId: "C0006826",
    canonicalName: "Malignant Neoplasm",
    aliases: ["cancer", "malignancy", "tumor", "carcinoma", "malignant tumor"],
    type: "disease",
  },
  {
    conceptId: "C0020538",
    canonicalName: "Hypertension",
    aliases: ["high blood pressure", "HTN", "arterial hypertension"],
    type: "disease",
  },
  {
    conceptId: "C0009450",
    canonicalName: "Communicable Diseases",
    aliases: ["infection", "infectious disease"],
    type: "disease",
  },

  // --- Chemicals / drugs ---
  {
    conceptId: "C0004057",
    canonicalName: "Aspirin",
    aliases: ["acetylsalicylic acid", "ASA", "acetosal"],
    type: "chemical",
  },
  {
    conceptId: "C0025598",
    canonicalName: "Metformin",
    aliases: ["dimethylbiguanide", "glucophage"],
    type: "chemical",
  },
  {
    conceptId: "C0032541",
    canonicalName: "Atorvastatin",
    aliases: ["lipitor"],
    type: "chemical",
  },
  {
    conceptId: "C0074554",
    canonicalName: "Simvastatin",
    aliases: ["zocor"],
    type: "chemical",
  },
  {
    conceptId: "C0072973",
    canonicalName: "Warfarin",
    aliases: ["coumadin", "warfarin sodium"],
    type: "chemical",
  },
  {
    conceptId: "C0028978",
    canonicalName: "Omeprazole",
    aliases: ["prilosec", "losec"],
    type: "chemical",
  },
  {
    conceptId: "C1565550",
    canonicalName: "Semaglutide",
    aliases: ["ozempic", "wegovy", "rybelsus"],
    type: "chemical",
  },
  {
    conceptId: "C0021665",
    canonicalName: "Insulin",
    aliases: ["insulin human"],
    type: "chemical",
  },

  // --- Genes / proteins ---
  {
    conceptId: "C0812258",
    canonicalName: "TP53 gene",
    aliases: ["TP53", "p53", "tumor protein p53", "TRP53"],
    type: "gene",
  },
  {
    conceptId: "C0812301",
    canonicalName: "BRCA1 gene",
    aliases: ["BRCA1", "breast cancer 1", "RNF53"],
    type: "gene",
  },
  {
    conceptId: "C0376571",
    canonicalName: "BRCA2 gene",
    aliases: ["BRCA2", "breast cancer 2", "FANCD1"],
    type: "gene",
  },
  {
    conceptId: "C1366544",
    canonicalName: "APOE gene",
    aliases: ["APOE", "apolipoprotein E", "AD2"],
    type: "gene",
  },
  {
    conceptId: "C1414313",
    canonicalName: "EGFR gene",
    aliases: ["EGFR", "epidermal growth factor receptor", "ERBB1", "HER1"],
    type: "gene",
  },
  {
    conceptId: "C0919524",
    canonicalName: "KRAS gene",
    aliases: ["KRAS", "K-ras", "KRAS2"],
    type: "gene",
  },
  {
    conceptId: "C1537502",
    canonicalName: "BRAF gene",
    aliases: ["BRAF", "B-raf", "BRAF1"],
    type: "gene",
  },

  // --- Variants ---
  {
    conceptId: "C3658290",
    canonicalName: "BRAF V600E",
    aliases: ["V600E", "BRAF p.V600E", "Val600Glu"],
    type: "variant",
  },
  {
    conceptId: "C4016532",
    canonicalName: "APOE e4 allele",
    aliases: ["APOE4", "APOE e4", "epsilon 4 allele", "e4 allele"],
    type: "variant",
  },
];

// ---------------------------------------------------------------------------
// Build scispaCy's two KB indexes ONCE from the dictionary (linking_utils._index_entities):
//   aliasToConcepts: normalized surface form -> concept ids that use it as an alias.
//   conceptById:     concept id -> the concept.
// Alias keys are normalized (lower-cased, whitespace-collapsed) so linking is
// case/spacing-insensitive, matching scispaCy comparing normalized strings.
// ---------------------------------------------------------------------------

function normalizeAlias(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

interface KbIndex {
  aliasToConcepts: Map<string, string[]>;
  conceptById: Map<string, KbConcept>;
}

function buildKbIndex(concepts: readonly KbConcept[]): KbIndex {
  const aliasToConcepts = new Map<string, string[]>();
  const conceptById = new Map<string, KbConcept>();
  for (const concept of concepts) {
    conceptById.set(concept.conceptId, concept);
    const allAliases = new Set([concept.canonicalName, ...concept.aliases]);
    for (const alias of allAliases) {
      const key = normalizeAlias(alias);
      if (key.length === 0) continue;
      const existing = aliasToConcepts.get(key);
      if (existing) {
        if (!existing.includes(concept.conceptId)) existing.push(concept.conceptId);
      } else {
        aliasToConcepts.set(key, [concept.conceptId]);
      }
    }
  }
  return { aliasToConcepts, conceptById };
}

const KB_INDEX: KbIndex = buildKbIndex(BIOMEDICAL_DICTIONARY);

// ---------------------------------------------------------------------------
// LINKING — map a mention string to a concept id via the KB index. scispaCy's linker
// returns the best candidate above a threshold, or nothing. Our deterministic analogue:
//   - EXACT alias hit (normalized) -> score 1.0.
//   - Otherwise, the highest containment overlap between the mention and any alias that
//     clears LINK_THRESHOLD -> that concept at the overlap score.
//   - Type mismatch is never linked (a "disease" mention won't link to a gene concept),
//     matching scispaCy's specialized NER feeding a type-consistent linker.
// No hit -> unlinked (null id, score 0), exactly as scispaCy leaves kb_ents empty.
// ---------------------------------------------------------------------------

// Minimum overlap for a non-exact link. scispaCy's default is 0.7; we mirror it.
export const LINK_THRESHOLD = 0.7;

/** Token-containment overlap in [0, 1] between a mention and an alias (order-free). */
function overlapScore(mention: string, alias: string): number {
  const mTokens = mention.split(" ").filter(Boolean);
  const aTokens = new Set(alias.split(" ").filter(Boolean));
  if (mTokens.length === 0 || aTokens.size === 0) return 0;
  let hits = 0;
  for (const t of mTokens) if (aTokens.has(t)) hits += 1;
  // Symmetric-ish: fraction of the alias's tokens covered by the mention, damped by any
  // extra mention tokens so "diabetes" vs "type 2 diabetes" scores below an exact hit.
  const aliasCoverage = hits / aTokens.size;
  const mentionPrecision = hits / mTokens.length;
  return Math.min(aliasCoverage, mentionPrecision);
}

export function linkMention(mentionText: string, type: EntityType): EntityLink {
  const norm = normalizeAlias(mentionText);
  const unlinked: EntityLink = { normalizedId: null, canonicalName: null, score: 0 };
  if (norm.length === 0) return unlinked;

  // Tier 1 — exact normalized alias hit. Prefer a concept of the matching type.
  const exactConcepts = KB_INDEX.aliasToConcepts.get(norm);
  if (exactConcepts) {
    const typed = exactConcepts
      .map((id) => KB_INDEX.conceptById.get(id))
      .filter((c): c is KbConcept => !!c && c.type === type);
    const chosen = typed[0] ?? KB_INDEX.conceptById.get(exactConcepts[0]);
    if (chosen && chosen.type === type) {
      return { normalizedId: chosen.conceptId, canonicalName: chosen.canonicalName, score: 1 };
    }
  }

  // Tier 2 — best fuzzy overlap over type-consistent concepts above threshold.
  let best: { concept: KbConcept; score: number } | null = null;
  for (const concept of BIOMEDICAL_DICTIONARY) {
    if (concept.type !== type) continue;
    const aliases = [concept.canonicalName, ...concept.aliases];
    for (const alias of aliases) {
      const score = overlapScore(norm, normalizeAlias(alias));
      if (score > (best?.score ?? 0)) best = { concept, score };
    }
  }
  if (best && best.score >= LINK_THRESHOLD) {
    return { normalizedId: best.concept.conceptId, canonicalName: best.concept.canonicalName, score: best.score };
  }

  return unlinked;
}

// ---------------------------------------------------------------------------
// ABBREVIATION DETECTION — a native port of scispaCy's Schwartz & Hearst (2003)
// algorithm (abbreviation.py: find_abbreviation / filter_matches). We scan for
// "long form ( SHORT )" patterns and, for each, verify the short form's characters can
// be matched back-to-front against the long form (first short char must start a word).
// The result maps each short form to its resolved long form, so a short-form mention
// links via its long form (scispaCy's resolve_abbreviations).
// ---------------------------------------------------------------------------

export interface Abbreviation {
  short: string;
  long: string;
}

// Port of find_abbreviation: can the characters of `short` be matched, right-to-left,
// against `long`, with the first short char aligning to the start of a word? Returns the
// long-form substring (from the matched start) or null.
function matchAbbreviation(long: string, short: string): string | null {
  let longIndex = long.length - 1;
  let shortIndex = short.length - 1;

  while (shortIndex >= 0) {
    const currentChar = short[shortIndex].toLowerCase();
    if (!/[a-z0-9]/.test(currentChar)) {
      shortIndex -= 1;
      continue;
    }
    while (
      (longIndex >= 0 && long[longIndex].toLowerCase() !== currentChar) ||
      (shortIndex === 0 && longIndex > 0 && /[a-z0-9]/i.test(long[longIndex - 1]))
    ) {
      longIndex -= 1;
    }
    if (longIndex < 0) return null;
    longIndex -= 1;
    shortIndex -= 1;
  }

  // Step back to the start of the word containing the matched start character.
  longIndex += 1;
  // Walk back to the beginning of that word.
  while (longIndex > 0 && /\S/.test(long[longIndex - 1])) longIndex -= 1;
  return long.slice(longIndex).trim();
}

// short_form_filter port: 2..10 chars, >=50% alpha, first char alpha.
function isPlausibleShortForm(short: string): boolean {
  if (short.length < 2 || short.length >= 10) return false;
  const alpha = [...short].filter((c) => /[a-z]/i.test(c)).length;
  if (alpha / short.length < 0.5) return false;
  return /[a-z]/i.test(short[0]);
}

export function findAbbreviations(text: string): Abbreviation[] {
  const out: Abbreviation[] = [];
  const seenShort = new Set<string>();
  // filter_matches' common case: "<long form> (<short form>)". Capture the parenthesized
  // short form and a window of preceding words as the long-form candidate.
  const re = /([A-Za-z][A-Za-z0-9'\-\s]{2,120}?)\s*\(([A-Za-z][A-Za-z0-9\-]{1,9})\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const longCandidate = m[1].trim();
    const short = m[2].trim();
    if (!isPlausibleShortForm(short)) continue;
    if (seenShort.has(short.toLowerCase())) continue;
    // Bound the long-form window to ~ (abbrev length + 5) words, per filter_matches.
    const words = longCandidate.split(/\s+/);
    const maxWords = Math.min(short.length + 5, short.length * 2);
    const windowed = words.slice(Math.max(0, words.length - maxWords)).join(" ");
    const resolved = matchAbbreviation(windowed, short);
    if (resolved && resolved.length > short.length) {
      out.push({ short, long: resolved });
      seenShort.add(short.toLowerCase());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Injectable dependencies. Default hits the real Claude client; tests pass a
// deterministic stub so no network / API key is touched.
// ---------------------------------------------------------------------------

export interface NerDeps {
  // Extract candidate biomedical mentions from source text. Returns validated,
  // schema-shaped candidates (offsets / links are added downstream by this module).
  extractMentions: (text: string) => Promise<RawMention[]>;
}

const NER_SYSTEM = [
  "You perform biomedical NAMED-ENTITY RECOGNITION on the provided text.",
  "Return ONLY a single JSON object of the form:",
  '{ "mentions": [ { "text": string, "type": string } ] }',
  "type MUST be one of: gene, disease, chemical, variant.",
  "  - gene: a gene or protein (e.g. TP53, EGFR, p53).",
  "  - disease: a disease, disorder, or condition (e.g. Alzheimer's disease, hypertension).",
  "  - chemical: a drug, chemical, or compound (e.g. aspirin, metformin).",
  "  - variant: a genetic variant / allele (e.g. V600E, APOE e4).",
  "text MUST be an EXACT, VERBATIM substring copied from the provided text — do not paraphrase, do not normalize, do not expand abbreviations.",
  "Tag every distinct occurrence you are confident about. If the text names no biomedical entities, return an empty mentions array.",
].join("\n");

async function defaultExtractMentions(text: string): Promise<RawMention[]> {
  const extraction = await callClaudeForJson({
    system: NER_SYSTEM,
    user: text,
    schema: NerExtractionSchema,
    maxTokens: 2048,
  });
  return extraction.mentions;
}

const defaultDeps: NerDeps = {
  extractMentions: (text) => defaultExtractMentions(text),
};

// ---------------------------------------------------------------------------
// GROUNDING + LINKING for a single candidate mention. Ground the mention verbatim in the
// input; drop it if it can't be located. Then, per scispaCy's resolve_abbreviations,
// link via the mention's long form when it's a known abbreviation, else via the mention
// itself. The grounded span always points at the ORIGINAL mention text/offsets even when
// linking used the expanded long form.
// ---------------------------------------------------------------------------

function groundAndLink(
  mention: RawMention,
  rawText: string,
  abbrevByShort: Map<string, string>
): LinkedEntity | null {
  const located = locateSpan(rawText, mention.text);
  if (!located) return null;
  const status: SpanGroundingStatus = located.status;

  const abbreviationOf = abbrevByShort.get(mention.text.trim().toLowerCase()) ?? null;
  // Link on the long form when this mention is a known abbreviation, else on itself.
  const linkTarget = abbreviationOf ?? located.text;
  const link = linkMention(linkTarget, mention.type);

  return {
    text: located.text, // verbatim input substring, never the model version
    type: mention.type,
    start: located.start,
    end: located.end,
    grounding: { status },
    link,
    abbreviationOf,
  };
}

// De-duplicate linked entities by (offset span, type) — the same span tagged twice
// collapses to one entity, mirroring scispaCy operating over doc.ents (unique spans).
function dedupeEntities(entities: readonly LinkedEntity[]): LinkedEntity[] {
  const byKey = new Map<string, LinkedEntity>();
  for (const e of entities) {
    const key = `${e.start}:${e.end}:${e.type}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  // Stable order: by start offset, then end.
  return [...byKey.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}

// ---------------------------------------------------------------------------
// recognizeEntities — the public entry point.
// ---------------------------------------------------------------------------

export async function recognizeEntities(
  input: { text: string },
  deps: NerDeps = defaultDeps
): Promise<NerResult> {
  const text = typeof input.text === "string" ? input.text : "";
  const empty: NerResult = { entities: [], groundingDroppedCount: 0, linkedCount: 0 };
  if (text.trim().length === 0) return empty;

  // Resolve abbreviations up front (native Schwartz-Hearst), keyed by short form.
  const abbrevByShort = new Map<string, string>();
  for (const a of findAbbreviations(text)) {
    abbrevByShort.set(a.short.trim().toLowerCase(), a.long);
  }

  // 1. NER — Claude proposes candidate mentions (honest-empty on LLM failure).
  const mentions = await deps.extractMentions(text).catch(() => [] as RawMention[]);
  if (mentions.length === 0) return empty;

  // 2. Ground each mention; drop the ungroundable. 3. Link the survivors.
  const linked: LinkedEntity[] = [];
  let groundingDroppedCount = 0;
  for (const mention of mentions) {
    const entity = groundAndLink(mention, text, abbrevByShort);
    if (entity) linked.push(entity);
    else groundingDroppedCount += 1;
  }

  const entities = dedupeEntities(linked);
  const linkedCount = entities.filter((e) => e.link.normalizedId !== null).length;

  return { entities, groundingDroppedCount, linkedCount };
}

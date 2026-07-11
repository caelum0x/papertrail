import { z } from "zod";

// Zod schemas + shared types for BIOMEDICAL NAMED-ENTITY RECOGNITION + ENTITY LINKING —
// a native port of scispaCy (backend/engines/scispacy).
//
// scispaCy's pipeline is: a trained NER model tags biomedical mentions, an
// AbbreviationDetector (Schwartz & Hearst 2003) resolves short forms to their long
// forms, and an EntityLinker (linking.py + linking_utils.py) maps each mention string
// to a knowledge-base concept id (a UMLS CUI / MeSH id) via a KnowledgeBase whose two
// core views are `alias_to_cuis` (surface form -> candidate concept ids) and
// `cui_to_entity` (concept id -> canonical name, aliases, type, definition).
//
// This module is the LLM trust boundary + typed contract:
//   1. Validate Claude's raw NER output (candidate mentions) before we trust it — never
//      JSON.parse a model response without a schema.
//   2. Give the native linker + grounding layer typed, normalized shapes so the
//      deterministic linking/grounding never defend against malformed records.
//
// LOAD-BEARING SPLIT (matching scispaCy's architecture, and this repo's convention that
// only the trained-model step goes to Claude):
//   - Claude does ONLY the NER: propose candidate mention spans + a coarse entity type.
//   - The LINKING (mention -> normalized id) is DETERMINISTIC native TS over an in-code
//     dictionary — a linker candidate never comes from the model.
//   - GROUNDING (mention -> exact substring + offsets in the input) is DETERMINISTIC
//     code via lib/grounding; an ungroundable mention is DROPPED, never asserted.

// ---------------------------------------------------------------------------
// Entity-type vocabulary — the coarse biomedical categories our NER tags.
//
// A closed set aligned with scispaCy's specialized NER models (BC5CDR: chemical +
// disease; JNLPBA/BioNLP: gene/protein; plus variant, common in clinical-trial claims).
// Anything outside this set is dropped at extraction rather than coerced — we never
// invent a type the model didn't ground.
// ---------------------------------------------------------------------------

export const ENTITY_TYPES = ["gene", "disease", "chemical", "variant"] as const;

export const EntityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof EntityTypeSchema>;

// ---------------------------------------------------------------------------
// Raw Claude NER shape. Claude proposes candidate mentions; each carries the exact
// `text` it tagged (which grounding will verify verbatim against the input) and a
// coarse `type`. No offsets, no normalized id — those are code's job (grounding assigns
// offsets, the native linker assigns the id).
// ---------------------------------------------------------------------------

export const RawMentionSchema = z.object({
  text: z.string().trim().min(1).max(200),
  type: EntityTypeSchema,
});
export type RawMention = z.infer<typeof RawMentionSchema>;

export const NerExtractionSchema = z.object({
  mentions: z.array(RawMentionSchema).max(200),
});
export type NerExtraction = z.infer<typeof NerExtractionSchema>;

// ---------------------------------------------------------------------------
// Linking result for a single mention. `normalizedId` is scispaCy's concept_id (a CUI /
// MeSH id from the dictionary) when the mention resolves against the KB, else null —
// scispaCy leaves `kb_ents` empty when no candidate clears the similarity threshold; we
// mirror that with a null id + zero score rather than forcing a wrong link. `score` is a
// DETERMINISTIC string-match confidence in [0, 1], NOT an LLM number.
// ---------------------------------------------------------------------------

export const EntityLinkSchema = z.object({
  // The concept id (e.g. a UMLS CUI "C0004096" or MeSH "D001249"), or null when the
  // mention does not resolve against the in-code KB above threshold.
  normalizedId: z.string().min(1).nullable(),
  // The KB canonical name for that concept id (null when unlinked).
  canonicalName: z.string().min(1).nullable(),
  // Deterministic linker confidence in [0, 1]: 1.0 for an exact alias hit, lower for a
  // normalized/fuzzy hit. 0 when unlinked.
  score: z.number().min(0).max(1),
});
export type EntityLink = z.infer<typeof EntityLinkSchema>;

// ---------------------------------------------------------------------------
// A linked entity — a mention that was GROUNDED verbatim in the input (exact offsets)
// and LINKED (possibly to null) against the KB. Offsets always point at a real
// substring of the input; `text` is the verbatim located substring, never the model's
// version. `abbreviationOf` carries the resolved long form when this mention was a
// short-form abbreviation (Schwartz-Hearst), mirroring scispaCy resolving abbreviations
// before linking.
// ---------------------------------------------------------------------------

export const LinkedEntitySchema = z.object({
  // Verbatim substring of the input we located (NOT the model's paraphrase).
  text: z.string().min(1),
  type: EntityTypeSchema,
  // Character offsets into the input, for in-place highlighting.
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  grounding: z.object({
    status: z.enum(["exact", "approximate"]),
  }),
  link: EntityLinkSchema,
  // When this mention is a defined abbreviation, its resolved long form (used for
  // linking, per scispaCy's resolve_abbreviations). Null otherwise.
  abbreviationOf: z.string().min(1).nullable(),
}).refine((obj) => obj.start < obj.end, {
  // Offsets are a half-open [start, end) range: `end` is exclusive so that the located
  // substring is input.slice(start, end). A valid grounded span is non-empty, so
  // start must be strictly less than end. Zero-length spans are forbidden here — this
  // mirrors the `text.min(1)` invariant above (an empty span could carry no text) and
  // guards against a mocked/buggy NER emitting an inverted or empty range. Grounding in
  // lib/grounding always returns valid offsets, so this never fires in production; it
  // hardens the LLM trust boundary against invalid LinkedEntity records.
  message: "start must be < end (offsets are a non-empty half-open [start, end) range)",
  path: ["start"],
});
export type LinkedEntity = z.infer<typeof LinkedEntitySchema>;

// ---------------------------------------------------------------------------
// The result of an NER + linking run: the grounded, linked entities plus honest counts
// of how many candidate mentions were dropped for being ungroundable, and how many of
// the surviving entities linked to a KB concept.
// ---------------------------------------------------------------------------

export const NerResultSchema = z.object({
  entities: z.array(LinkedEntitySchema),
  // Candidate mentions dropped because their text was not a locatable substring.
  groundingDroppedCount: z.number().int().nonnegative(),
  // How many surviving entities resolved to a non-null normalized id.
  linkedCount: z.number().int().nonnegative(),
});
export type NerResult = z.infer<typeof NerResultSchema>;

// ---------------------------------------------------------------------------
// Public request schema for POST /api/entities. Free-form source text, length-capped,
// never logged.
// ---------------------------------------------------------------------------

export const EntitiesRequestSchema = z.object({
  text: z.string().min(3).max(20_000),
});
export type EntitiesRequest = z.infer<typeof EntitiesRequestSchema>;

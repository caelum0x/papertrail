// CONTEXT-AWARE MECHANISM EXTRACTION — a native TypeScript port of INDRA's RefContext /
// BioContext idea (backend/engines/indra/indra/statements/context.py), layered ON TOP of
// the existing mechanism assembler (lib/mechanism/assemble.ts). It does NOT rewrite the
// assembler; it consumes its already-grounded, already-scored statements and attaches a
// biological CONTEXT to each so preclinical→human translation can be de-risked.
//
// Pipeline (tagMechanismContext):
//   1. ASSEMBLE — reuse assembleMechanisms() verbatim (Claude extracts, code grounds +
//      scores). We touch none of that.
//   2. TAG — Claude proposes CANDIDATE context tags per statement (tissue / species /
//      assay system), each with the exact verbatim quote it drew the tag from. This is
//      the ONLY LLM step here, validated against a Zod schema at the trust boundary.
//   3. GROUND — every candidate tag's quote is located verbatim in the source text via
//      lib/grounding locateSpan. A tag whose quote can't be located is DROPPED (INDRA
//      never keeps an ungrounded RefContext slot; PaperTrail never makes an unsourced
//      claim about the source). Dropped tags are counted, never hidden.
//   4. RESOLVE — the grounded candidate tags are folded into a deterministic
//      MechanismContext (tissue UBERON-ish, species NCBI-taxon, assay OBI-ish) by a pure
//      classifier — no LLM decides the final species/assay bucket.
//   5. SCORE — a DETERMINISTIC translation-confidence score is computed from the resolved
//      context alone (human in-vivo > animal in-vivo > in-vitro). No LLM number is
//      load-bearing.
//
// filterHumanInVivo() is a pure predicate over the resolved context. Nothing here is
// mutated in place; every function returns new objects.

import { locateSpan } from "../grounding";
import { callClaudeForJson } from "../claude";
import { assembleMechanisms, type MechanismDeps } from "./assemble";
import type { KgPool } from "../kg/repository";
import {
  ContextTaggingSchema,
  SPECIES_CONFIDENCE,
  ASSAY_CONFIDENCE,
  type ContextTagKind,
  type ContextedMechanismResult,
  type ContextedMechanismStatement,
  type GroundedContextTag,
  type MechanismContext,
  type MechanismStatement,
  type RawContextTag,
  type Species,
  type AssaySystem,
  type SourceTier,
} from "./schemas";

// ---------------------------------------------------------------------------
// Injectable dependencies. The assembly deps are passed straight through to
// assembleMechanisms (so the assembler is reused, not reimplemented); `tagContext`
// is the new context-candidate step. Defaults hit the real Claude client; tests inject
// deterministic stubs so no network is touched.
// ---------------------------------------------------------------------------

export interface MechanismContextDeps {
  // Reuse the existing assembler's extraction step unchanged.
  assembly?: MechanismDeps;
  // Propose candidate context tags for a batch of statements from the source text.
  tagContext: (
    text: string,
    statements: readonly MechanismStatement[]
  ) => Promise<RawContextTag[]>;
}

const TAGGING_SYSTEM = [
  "You annotate the BIOLOGICAL CONTEXT of causal mechanistic statements already extracted",
  "from a biomedical source. For each statement index you are shown, propose zero or more",
  "context tags describing WHERE the mechanism was observed.",
  "Return ONLY a single JSON object of the form:",
  '{ "tags": [ { "statementIndex": number, "kind": string, "value": string, "evidenceQuote": string } ] }',
  "kind MUST be one of: tissue, species, assay.",
  "  - tissue: the anatomical tissue/organ/cell type (e.g. liver, hepatocytes, cortex).",
  "  - species: the organism (e.g. human, patients, mouse, murine, rat, or a cell line / in vitro system).",
  "  - assay: the experimental system (in vivo, in vitro, cell line, ex vivo, clinical).",
  "value is the short surface term you read (e.g. 'mouse', 'hepatocytes', 'in vitro').",
  "evidenceQuote MUST be an EXACT, VERBATIM substring copied from the provided text that",
  "states the context — do not paraphrase, do not add words.",
  "Only include tags the text actually asserts. If a statement has no stated context, emit no tags for it.",
].join("\n");

// Default context tagger: Claude proposes candidates, validated against the Zod schema.
async function defaultTagContext(
  text: string,
  statements: readonly MechanismStatement[]
): Promise<RawContextTag[]> {
  // Give the model the statements it is annotating (index + triple only — no belief, no
  // offsets; those are code's job) alongside the full source text.
  const statementList = statements
    .map((s, i) => `[${i}] ${s.subj} ${s.relation} ${s.obj}`)
    .join("\n");
  const user = [
    "SOURCE TEXT:",
    text,
    "",
    "STATEMENTS TO ANNOTATE (by index):",
    statementList,
  ].join("\n");

  const tagging = await callClaudeForJson({
    system: TAGGING_SYSTEM,
    user,
    schema: ContextTaggingSchema,
    maxTokens: 2048,
  });
  return tagging.tags;
}

const defaultDeps: MechanismContextDeps = {
  tagContext: (text, statements) => defaultTagContext(text, statements),
};

// ---------------------------------------------------------------------------
// Deterministic classifiers — map a grounded surface term to a normalized bucket.
// These are the code that DECIDES the final species/assay; Claude only proposed the
// surface term + quote. Pure string rules, documented, auditable, no LLM.
// ---------------------------------------------------------------------------

// NCBI-taxon-ish species buckets keyed off documented surface-term rules.
const HUMAN_TERMS = [
  "human",
  "humans",
  "patient",
  "patients",
  "homo sapiens",
  "clinical",
  "subjects",
  "participants",
  "men",
  "women",
];
const MOUSE_TERMS = ["mouse", "mice", "murine", "mus musculus"];
const RAT_TERMS = ["rat", "rats", "rattus"];
const IN_VITRO_SPECIES_TERMS = [
  "in vitro",
  "cell line",
  "cell-line",
  "cultured",
  "culture",
  "hek293",
  "hela",
  "cell culture",
];

function includesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// Resolve a normalized species from a grounded surface term. Returns null when the term
// matches no known bucket — an unresolved tag is dropped rather than forced.
export function classifySpecies(surface: string): Species | null {
  const s = surface.trim().toLowerCase();
  if (s.length === 0) return null;
  // Order matters: an explicit organism wins over the in-vitro fallback.
  if (includesAny(s, HUMAN_TERMS)) return "human";
  if (includesAny(s, MOUSE_TERMS)) return "mouse";
  if (includesAny(s, RAT_TERMS)) return "rat";
  if (includesAny(s, IN_VITRO_SPECIES_TERMS)) return "in-vitro";
  return null;
}

// OBI-ish assay/system buckets.
const IN_VIVO_TERMS = ["in vivo", "in-vivo", "animal", "mouse", "mice", "rat", "patient", "clinical", "murine"];
const CELL_LINE_TERMS = ["cell line", "cell-line", "hek293", "hela", "immortalized", "cultured line"];
const IN_VITRO_ASSAY_TERMS = ["in vitro", "in-vitro", "cultured", "culture", "cell culture", "biochemical", "reconstituted"];

// Resolve a normalized assay/system from a grounded surface term. Returns null when the
// term matches no known bucket.
export function classifyAssay(surface: string): AssaySystem | null {
  const s = surface.trim().toLowerCase();
  if (s.length === 0) return null;
  // Cell line is a more specific in-vitro subtype; check it before the generic in-vitro.
  if (includesAny(s, CELL_LINE_TERMS)) return "cell-line";
  if (includesAny(s, IN_VITRO_ASSAY_TERMS)) return "in-vitro";
  if (includesAny(s, IN_VIVO_TERMS)) return "in-vivo";
  return null;
}

// ---------------------------------------------------------------------------
// Grounding — locate a candidate tag's quote verbatim in the source text. A tag whose
// quote can't be located is dropped (returned null), mirroring the assembler's rule.
// ---------------------------------------------------------------------------

function groundTag(candidate: RawContextTag, rawText: string): GroundedContextTag | null {
  const located = locateSpan(rawText, candidate.evidenceQuote);
  if (!located) return null;
  return {
    kind: candidate.kind,
    value: candidate.value,
    quote: located.text, // verbatim source substring, never the model paraphrase
    grounding: { status: located.status, start: located.start, end: located.end },
  };
}

// ---------------------------------------------------------------------------
// Context resolution — fold a statement's grounded tags into a normalized
// MechanismContext. Each of tissue / species / assay is resolved from the FIRST grounded
// tag of that kind that a deterministic classifier accepts; anything unresolved is left
// null (honest "unknown" over a forced bucket). Returns a new object.
// ---------------------------------------------------------------------------

function firstResolved<T>(
  tags: readonly GroundedContextTag[],
  kind: ContextTagKind,
  classify: (surface: string) => T | null
): { value: T; tag: GroundedContextTag } | null {
  for (const t of tags) {
    if (t.kind !== kind) continue;
    const value = classify(t.value);
    if (value !== null) return { value, tag: t };
  }
  return null;
}

function resolveContext(tags: readonly GroundedContextTag[]): MechanismContext {
  // Tissue is free-text (UBERON-ish surface term) — the first grounded tissue tag stands
  // as-is; we do not force it into a closed vocabulary.
  const tissueTag = tags.find((t) => t.kind === "tissue") ?? null;
  const species = firstResolved(tags, "species", classifySpecies);
  const assay = firstResolved(tags, "assay", classifyAssay);

  // A species term like "mouse" also implies an in-vivo assay when no explicit assay tag
  // resolved — infer it deterministically so an animal study without the literal words
  // "in vivo" is still classed as in-vivo. This is a documented rule, not an LLM guess.
  const inferredAssay: AssaySystem | null =
    assay?.value ??
    (species?.value === "in-vitro"
      ? "in-vitro"
      : species?.value === "human" || species?.value === "mouse" || species?.value === "rat"
        ? "in-vivo"
        : null);

  return {
    tissue: tissueTag ? tissueTag.value : null,
    species: species ? species.value : null,
    assay: inferredAssay,
    tags: [...tags],
  };
}

// ---------------------------------------------------------------------------
// Translation confidence — DETERMINISTIC. How well does a mechanism's observed context
// support extrapolation to human in-vivo biology?
//
//   human in-vivo   > animal in-vivo   > in-vitro / cell-line   > unknown
//
// The score is the product of a species factor and an assay factor, both drawn from
// documented constant tables (schemas.ts). No LLM number enters this; same context →
// same score, always.
// ---------------------------------------------------------------------------

export function translationConfidence(context: MechanismContext): number {
  const speciesFactor = context.species ? SPECIES_CONFIDENCE[context.species] : SPECIES_CONFIDENCE.unknown;
  const assayFactor = context.assay ? ASSAY_CONFIDENCE[context.assay] : ASSAY_CONFIDENCE.unknown;
  return Number((speciesFactor * assayFactor).toFixed(4));
}

// ---------------------------------------------------------------------------
// filterHumanInVivo — pure predicate + filter. Keep only mechanisms observed in human
// in-vivo systems (the gold standard for translation). Returns a NEW array; input is not
// mutated. A mechanism whose species OR assay is unresolved is NOT human in-vivo (honest
// exclusion over an optimistic inclusion).
// ---------------------------------------------------------------------------

export function isHumanInVivo(context: MechanismContext): boolean {
  return context.species === "human" && context.assay === "in-vivo";
}

export function filterHumanInVivo(
  statements: readonly ContextedMechanismStatement[]
): ContextedMechanismStatement[] {
  return statements.filter((s) => isHumanInVivo(s.context));
}

// ---------------------------------------------------------------------------
// tagMechanismContext — the public entry point. Reuses the assembler, then tags +
// grounds + resolves + scores context for each statement. Optionally filters to human
// in-vivo. Degrades to an honest result on any failure rather than fabricating context.
// ---------------------------------------------------------------------------

export async function tagMechanismContext(
  input: { text: string; tier?: SourceTier; requireHumanInVivo?: boolean },
  pool: KgPool | null,
  deps: MechanismContextDeps = defaultDeps
): Promise<ContextedMechanismResult> {
  const text = typeof input.text === "string" ? input.text : "";
  const requireHumanInVivo = input.requireHumanInVivo === true;

  const emptyContext = (): MechanismContext => ({
    tissue: null,
    species: null,
    assay: null,
    tags: [],
  });

  const empty: ContextedMechanismResult = {
    statements: [],
    groundingDroppedCount: 0,
    contextTagsDroppedCount: 0,
    edgesUpserted: 0,
    filteredHumanInVivo: requireHumanInVivo,
    filteredOutCount: 0,
  };
  if (text.trim().length === 0) return empty;

  // 1. Reuse the existing assembler verbatim (Claude extract → ground → belief → persist).
  const assembly = await assembleMechanisms({ text, tier: input.tier }, pool, deps.assembly);
  if (assembly.statements.length === 0) {
    return { ...empty, groundingDroppedCount: assembly.groundingDroppedCount, edgesUpserted: assembly.edgesUpserted };
  }

  // 2. Propose candidate context tags (honest-empty on LLM failure — statements still
  //    stand, just without context).
  const candidateTags = await deps
    .tagContext(text, assembly.statements)
    .catch(() => [] as RawContextTag[]);

  // 3. Ground each candidate tag; bucket the survivors by statement index; count drops.
  const tagsByStatement = new Map<number, GroundedContextTag[]>();
  let contextTagsDroppedCount = 0;
  for (const candidate of candidateTags) {
    if (candidate.statementIndex < 0 || candidate.statementIndex >= assembly.statements.length) {
      // A tag pointing at a nonexistent statement is unusable — drop it honestly.
      contextTagsDroppedCount += 1;
      continue;
    }
    const grounded = groundTag(candidate, text);
    if (!grounded) {
      contextTagsDroppedCount += 1;
      continue;
    }
    const bucket = tagsByStatement.get(candidate.statementIndex) ?? [];
    tagsByStatement.set(candidate.statementIndex, [...bucket, grounded]);
  }

  // 4 + 5. Resolve context + score translation confidence per statement (deterministic).
  const contexted: ContextedMechanismStatement[] = assembly.statements.map((stmt, i) => {
    const tags = tagsByStatement.get(i) ?? [];
    const context = tags.length > 0 ? resolveContext(tags) : emptyContext();
    return {
      ...stmt,
      context,
      translationConfidence: translationConfidence(context),
    };
  });

  // Highest-translation-confidence first (ties fall back to belief) — the most
  // translatable, best-corroborated mechanisms lead.
  const ordered = [...contexted].sort((a, b) => {
    if (b.translationConfidence !== a.translationConfidence) {
      return b.translationConfidence - a.translationConfidence;
    }
    return b.belief - a.belief;
  });

  // Optional deterministic filter to human in-vivo mechanisms.
  const kept = requireHumanInVivo ? filterHumanInVivo(ordered) : ordered;
  const filteredOutCount = ordered.length - kept.length;

  return {
    statements: kept,
    groundingDroppedCount: assembly.groundingDroppedCount,
    contextTagsDroppedCount,
    edgesUpserted: assembly.edgesUpserted,
    filteredHumanInVivo: requireHumanInVivo,
    filteredOutCount,
  };
}

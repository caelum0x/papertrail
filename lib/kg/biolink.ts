// Biolink-model TYPING for the Biomedical Evidence Knowledge Graph.
//
// Ported from BioCypher (backend/engines/biocypher) — specifically its ontology-
// mapping model (`_mapping.py` / `_ontology.py` / the `schema_config.yaml` tutorial
// examples). BioCypher's job is to take a project's own vocabulary (its `input_label`
// strings for nodes, and edge labels) and pin each one to a canonical class in the
// Biolink model via an `is_a` hierarchy, so heterogeneous sources speak one ontology.
//
// We DON'T need BioCypher's YAML machinery or its `urlopen`-of-remote-ontology paths —
// our vocabulary is small, closed, and known at compile time (see lib/kg/schemas.ts:
// KG_ENTITY_TYPES / KG_PREDICATES). So this is a DOCUMENTED STATIC MAPPING: the exact
// same `input_label -> Biolink category` and `edge_label -> Biolink predicate`
// resolution BioCypher performs, but as a pure, immutable TypeScript lookup with no
// I/O. Nothing here calls out; nothing here is LLM-derived.
//
// Canonical strings follow the Biolink Model's CURIE convention: categories are
// `biolink:PascalCase`, predicates are `biolink:snake_case`. These are the same
// canonical names BioCypher resolves our leaf classes up to.

import { KG_ENTITY_TYPES, KG_PREDICATES } from "./schemas";
import type { KgEntityType, KgPredicate } from "./schemas";

// ---------------------------------------------------------------------------
// Biolink category for each of OUR entity types.
//
// The mapping mirrors BioCypher's ontology `is_a` resolution to the Biolink model:
//   - a gene node    -> biolink:Gene
//   - a disease node -> biolink:Disease
//   - a chemical     -> biolink:ChemicalEntity  (Biolink's parent chemical class)
//   - a drug         -> biolink:Drug            (a ChemicalEntity subclass in Biolink)
//   - a variant      -> biolink:SequenceVariant
//   - a species      -> biolink:OrganismTaxon
// Every KgEntityType has exactly one canonical category; the object is `Readonly` and
// exhaustively keyed so an unmapped type is a compile-time error, never a silent gap.
// ---------------------------------------------------------------------------

export const BIOLINK_CATEGORY: Readonly<Record<KgEntityType, string>> = {
  gene: "biolink:Gene",
  disease: "biolink:Disease",
  chemical: "biolink:ChemicalEntity",
  variant: "biolink:SequenceVariant",
  species: "biolink:OrganismTaxon",
  drug: "biolink:Drug",
} as const;

// The Biolink `is_a` ancestor chain for each category, most-specific first, rooted at
// biolink:NamedThing. Ported from the Biolink model class hierarchy BioCypher walks
// when it resolves a leaf class. Used so a query for a broad category (e.g.
// biolink:ChemicalEntity) still matches a more specific drug node — the same
// subsumption BioCypher relies on. Immutable, closed, no I/O.
export const BIOLINK_CATEGORY_ANCESTORS: Readonly<Record<KgEntityType, readonly string[]>> = {
  gene: ["biolink:Gene", "biolink:GeneOrGeneProduct", "biolink:BiologicalEntity", "biolink:NamedThing"],
  disease: ["biolink:Disease", "biolink:DiseaseOrPhenotypicFeature", "biolink:BiologicalEntity", "biolink:NamedThing"],
  chemical: ["biolink:ChemicalEntity", "biolink:ChemicalOrDrugOrTreatment", "biolink:NamedThing"],
  variant: ["biolink:SequenceVariant", "biolink:BiologicalEntity", "biolink:NamedThing"],
  species: ["biolink:OrganismTaxon", "biolink:NamedThing"],
  drug: ["biolink:Drug", "biolink:ChemicalEntity", "biolink:ChemicalOrDrugOrTreatment", "biolink:NamedThing"],
} as const;

// ---------------------------------------------------------------------------
// Biolink predicate for each of OUR edge labels.
//
// BioCypher maps a source's edge label to a canonical Biolink `related_to` descendant.
// Our closed predicate vocabulary resolves as:
//   - associates_with -> biolink:associated_with  (gene/variant <-> disease)
//   - targets         -> biolink:target_for       (drug -> gene mechanism of action)
//   - treats          -> biolink:treats           (drug -> disease)
// Exhaustively keyed over KG_PREDICATES; immutable.
// ---------------------------------------------------------------------------

export const BIOLINK_PREDICATE: Readonly<Record<KgPredicate, string>> = {
  associates_with: "biolink:associated_with",
  targets: "biolink:target_for",
  treats: "biolink:treats",
} as const;

// The domain (subject) and range (object) Biolink categories each predicate expects,
// ported from the Biolink model's slot `domain`/`range` on these association slots.
// This is what lets a consumer validate that a proposed (subject, predicate, object)
// triple is ontologically well-typed before treating it as a hypothesis.
export interface BiolinkPredicateShape {
  readonly predicate: string;
  readonly domain: readonly string[];
  readonly range: readonly string[];
}

export const BIOLINK_PREDICATE_SHAPE: Readonly<Record<KgPredicate, BiolinkPredicateShape>> = {
  associates_with: {
    predicate: "biolink:associated_with",
    domain: ["biolink:Gene", "biolink:SequenceVariant"],
    range: ["biolink:Disease"],
  },
  targets: {
    predicate: "biolink:target_for",
    domain: ["biolink:Drug", "biolink:ChemicalEntity"],
    range: ["biolink:Gene"],
  },
  treats: {
    predicate: "biolink:treats",
    domain: ["biolink:Drug", "biolink:ChemicalEntity"],
    range: ["biolink:Disease"],
  },
} as const;

// ---------------------------------------------------------------------------
// Resolution helpers — the small public surface, all pure.
// ---------------------------------------------------------------------------

const ENTITY_TYPE_SET: ReadonlySet<string> = new Set(KG_ENTITY_TYPES);
const PREDICATE_SET: ReadonlySet<string> = new Set(KG_PREDICATES);

function isKgEntityType(value: string): value is KgEntityType {
  return ENTITY_TYPE_SET.has(value);
}

function isKgPredicate(value: string): value is KgPredicate {
  return PREDICATE_SET.has(value);
}

// Resolve one of OUR entity_type strings to its canonical Biolink category. Returns
// null for a string outside our closed vocabulary — we NEVER invent a category for an
// unknown type (the same honesty rule the rest of the KG follows: unknown => drop, not
// coerce).
export function toBiolinkCategory(entityType: string): string | null {
  if (!isKgEntityType(entityType)) return null;
  return BIOLINK_CATEGORY[entityType];
}

// Resolve one of OUR predicate strings to its canonical Biolink predicate CURIE, or
// null if it is outside the closed vocabulary.
export function toBiolinkPredicate(predicate: string): string | null {
  if (!isKgPredicate(predicate)) return null;
  return BIOLINK_PREDICATE[predicate];
}

// The Biolink `is_a` ancestor chain for an entity type (most-specific first), or an
// empty array for an unknown type. Enables subsumption checks without any I/O.
export function biolinkAncestors(entityType: string): readonly string[] {
  if (!isKgEntityType(entityType)) return [];
  return BIOLINK_CATEGORY_ANCESTORS[entityType];
}

// True when a node of `entityType` IS-A `biolinkCategory` under the Biolink hierarchy
// (reflexive: a gene is-a biolink:Gene, and is-a biolink:NamedThing). Mirrors
// BioCypher's subsumption test used when matching a node to an ontology class.
export function isCategoryA(entityType: string, biolinkCategory: string): boolean {
  return biolinkAncestors(entityType).includes(biolinkCategory);
}

// Structural check that a (subjectType, predicate, objectType) triple is ontologically
// well-typed per the Biolink slot domain/range — i.e. the subject's category is (or
// descends from) an allowed domain class and the object's from an allowed range class.
// A well-typed check on a PREDICTED link is what separates a plausible hypothesis from
// a nonsensical one; unknown vocabulary fails closed (returns false).
export function isWellTypedTriple(
  subjectType: string,
  predicate: string,
  objectType: string
): boolean {
  if (!isKgPredicate(predicate)) return false;
  const shape = BIOLINK_PREDICATE_SHAPE[predicate];
  const subjectOk = shape.domain.some((cls) => isCategoryA(subjectType, cls));
  const objectOk = shape.range.some((cls) => isCategoryA(objectType, cls));
  return subjectOk && objectOk;
}

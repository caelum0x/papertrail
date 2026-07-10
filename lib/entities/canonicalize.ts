// DETERMINISTIC entity CANONICALIZER — resolve a free-text surface form to a stable
// ontology concept (a CURIE + canonical label + cross-refs) against the 0062 ontology
// tables, WITHOUT an LLM in the loop.
//
// MOAT: Claude is used ONLY for NER (lib/entities/ner.ts). Id resolution here is a pure,
// reproducible lexical lookup:
//   1. Normalize the surface (lower-case, collapse whitespace).
//   2. Exact match against ontology_synonyms.synonym_norm.
//   3. If a `type` was supplied, keep only terms whose ontology_terms.term_type matches.
//   4. On an obsolete term, forward to its replaced_by successor.
// A surface that matches nothing returns null — an honest miss, never a fabricated link
// (matching the CLAUDE.md rule that a wrong "confident" answer is worse than an honest
// "couldn't verify"). The score is a DETERMINISTIC string-match confidence (1.0 for an
// exact synonym hit), NOT an LLM number.

import type { Pool } from "pg";
import { getTerm, getXrefs, type OntologyTerm } from "@/lib/bio/ontology";

// ---------------------------------------------------------------------------
// Public contract (per the CANONICALIZER CONTRACT in ARCHITECTURE-ENTERPRISE.md §3).
// ---------------------------------------------------------------------------

export interface CanonicalEntity {
  curie: string;
  canonicalLabel: string;
  ontology: string;
  termType: string | null;
  score: number;
  xrefs: string[];
}

// Exact synonym hit → full confidence. Kept as a named constant so the deterministic
// scoring is documented in one place rather than a magic literal.
const EXACT_MATCH_SCORE = 1.0;

// ---------------------------------------------------------------------------
// Normalize a surface form: trim, lower-case, collapse internal whitespace runs to a
// single space. This MUST mirror how synonym_norm was written at ingest time so the exact
// match lands. Pure function — same input, same output.
// ---------------------------------------------------------------------------

export function normalizeSurface(surface: string): string {
  return surface.trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Build the CanonicalEntity shape from a resolved term + its xrefs.
// ---------------------------------------------------------------------------

function toCanonical(term: OntologyTerm, xrefs: string[], score: number): CanonicalEntity {
  return {
    curie: term.curie,
    canonicalLabel: term.label,
    ontology: term.ontology,
    termType: term.termType,
    score,
    xrefs,
  };
}

// ---------------------------------------------------------------------------
// resolveEntity — resolve ONE surface form. Returns null when nothing matches (honest
// miss). Deterministic: exact normalized-synonym lookup, optional term_type filter,
// obsolete→replaced_by forwarding.
// ---------------------------------------------------------------------------

export async function resolveEntity(
  pool: Pool,
  surface: string,
  type?: string
): Promise<CanonicalEntity | null> {
  const norm = normalizeSurface(surface);
  if (norm.length === 0) return null;

  // Exact match on the normalized synonym, joined to its owning term. When a `type` is
  // supplied we filter on ontology_terms.term_type in-SQL so a same-spelling concept of a
  // different kind can't win. Parameterized ($1/$2) — never interpolated.
  const params: Array<string> = [norm];
  let typeClause = "";
  if (type !== undefined && type.trim().length > 0) {
    params.push(type.trim());
    typeClause = ` and t.term_type = $2`;
  }

  const { rows } = await pool.query<{ curie: string }>(
    `select t.curie
       from ontology_synonyms s
       join ontology_terms t on t.curie = s.curie
      where lower(s.synonym_norm) = $1${typeClause}
      -- Prefer a live term over an obsolete one when both share a synonym; then a stable
      -- ordering by curie so the resolution is reproducible for a given surface.
      order by t.obsolete asc, t.curie asc
      limit 1`,
    params
  );

  const hit = rows[0];
  if (!hit) return null;

  const term = await getTerm(pool, hit.curie);
  if (!term) return null;

  // Obsolete → forward to the replacement term when one is recorded. If the successor is
  // missing (partial import) we honestly fall back to the obsolete term itself rather than
  // dropping the resolution.
  if (term.obsolete && term.replacedBy) {
    const successor = await getTerm(pool, term.replacedBy);
    if (successor && !successor.obsolete) {
      const successorXrefs = await getXrefs(pool, successor.curie);
      return toCanonical(successor, successorXrefs, EXACT_MATCH_SCORE);
    }
  }

  const xrefs = await getXrefs(pool, term.curie);
  return toCanonical(term, xrefs, EXACT_MATCH_SCORE);
}

// ---------------------------------------------------------------------------
// resolveMany — resolve a batch of surfaces (parallel), preserving input order. Each slot
// is a CanonicalEntity or null (honest per-surface miss), so the caller can align results
// to inputs 1:1.
// ---------------------------------------------------------------------------

export async function resolveMany(
  pool: Pool,
  surfaces: readonly string[],
  type?: string
): Promise<Array<CanonicalEntity | null>> {
  return Promise.all(surfaces.map((surface) => resolveEntity(pool, surface, type)));
}

// DETERMINISTIC query helpers over the 0062 bio-ontology tables (ontology_terms,
// ontology_synonyms, ontology_xrefs, ontology_edges, cell_marker_panels,
// gene_signatures). These are PUBLIC reference facts (no org_id), mirroring bio_cache
// (0051) and kg_nodes (0052).
//
// MOAT: nothing here calls an LLM. Every function is a pure, parameterized SQL read
// ($1/$2 placeholders — never string-interpolated) whose result is exactly what the
// curated ontology tables hold. A miss returns null / an empty array (an honest "not
// found"), never a fabricated concept.

import type { Pool } from "pg";

// ---------------------------------------------------------------------------
// Row/return types — explicit shapes for the ontology reads. These mirror the 0062
// columns; consumers (canonicalize.ts, marker checks) depend on these, not on raw rows.
// ---------------------------------------------------------------------------

export interface OntologyTerm {
  curie: string;
  ontology: string;
  label: string;
  termType: string | null;
  obsolete: boolean;
  replacedBy: string | null;
}

export interface CellMarker {
  cellTypeCurie: string | null;
  cellTypeLabel: string | null;
  geneCurie: string | null;
  geneSymbol: string | null;
  direction: string | null;
  tissueCurie: string | null;
  source: string | null;
  pmid: string | null;
}

export interface GeneSignature {
  signatureId: string;
  name: string | null;
  source: string | null;
  geneSymbols: string[];
  provenance: string | null;
}

// Bound on the recursive is_a walk so a malformed (cyclic) ontology import can never
// spin — real ontology hierarchies are shallow, so this is generous.
const MAX_SUBCLASS_DEPTH = 32;

// ---------------------------------------------------------------------------
// getTerm — fetch one canonical concept by its exact CURIE. Returns null when the CURIE
// is unknown (honest miss).
// ---------------------------------------------------------------------------

export async function getTerm(pool: Pool, curie: string): Promise<OntologyTerm | null> {
  const key = curie.trim();
  if (key.length === 0) return null;

  const { rows } = await pool.query<{
    curie: string;
    ontology: string;
    label: string;
    term_type: string | null;
    obsolete: boolean;
    replaced_by: string | null;
  }>(
    `select curie, ontology, label, term_type, obsolete, replaced_by
       from ontology_terms
      where curie = $1
      limit 1`,
    [key]
  );

  const row = rows[0];
  if (!row) return null;
  return {
    curie: row.curie,
    ontology: row.ontology,
    label: row.label,
    termType: row.term_type,
    obsolete: row.obsolete,
    replacedBy: row.replaced_by,
  };
}

// ---------------------------------------------------------------------------
// getXrefs — the cross-reference CURIEs for a term (equivalent ids in other databases).
// Returns [] when the term has none or is unknown.
// ---------------------------------------------------------------------------

export async function getXrefs(pool: Pool, curie: string): Promise<string[]> {
  const key = curie.trim();
  if (key.length === 0) return [];

  const { rows } = await pool.query<{ xref_curie: string }>(
    `select xref_curie
       from ontology_xrefs
      where curie = $1
      order by xref_curie asc`,
    [key]
  );
  return rows.map((r) => r.xref_curie);
}

// ---------------------------------------------------------------------------
// isSubclassOf — is `a` an is_a descendant of `b` (or equal to it)? A bounded, iterative
// walk up the ontology_edges is_a graph from `a` toward `b`. Deterministic: pure graph
// reachability over the curated edges, no inference. Returns true for a === b.
// ---------------------------------------------------------------------------

export async function isSubclassOf(pool: Pool, a: string, b: string): Promise<boolean> {
  const start = a.trim();
  const target = b.trim();
  if (start.length === 0 || target.length === 0) return false;
  if (start === target) return true;

  const visited = new Set<string>([start]);
  let frontier: string[] = [start];

  for (let depth = 0; depth < MAX_SUBCLASS_DEPTH && frontier.length > 0; depth += 1) {
    const { rows } = await pool.query<{ object_curie: string }>(
      `select distinct object_curie
         from ontology_edges
        where predicate = 'is_a'
          and subject_curie = any($1::text[])`,
      [frontier]
    );

    const next: string[] = [];
    for (const row of rows) {
      const parent = row.object_curie;
      if (parent === target) return true;
      if (!visited.has(parent)) {
        visited.add(parent);
        next.push(parent);
      }
    }
    frontier = next;
  }

  return false;
}

// ---------------------------------------------------------------------------
// getMarkersForCellType — the curated marker panel for a cell type, addressed either by
// its CURIE or (case-insensitively) by its label. Returns [] when nothing matches.
// ---------------------------------------------------------------------------

export async function getMarkersForCellType(
  pool: Pool,
  cellTypeCurieOrLabel: string
): Promise<CellMarker[]> {
  const key = cellTypeCurieOrLabel.trim();
  if (key.length === 0) return [];

  const { rows } = await pool.query<{
    cell_type_curie: string | null;
    cell_type_label: string | null;
    gene_curie: string | null;
    gene_symbol: string | null;
    direction: string | null;
    tissue_curie: string | null;
    source: string | null;
    pmid: string | null;
  }>(
    // Exact CURIE / exact label first; then a contains-match either direction so a
    // shorthand ("CD8 memory-like") resolves to the curated label ("CD8 memory-like
    // T cell") and vice versa. Still deterministic — a substring of a curated label,
    // never a fabricated concept. The exact matches are preferred via the ORDER BY.
    `select cell_type_curie, cell_type_label, gene_curie, gene_symbol,
            direction, tissue_curie, source, pmid,
            case
              when cell_type_curie = $1 or lower(cell_type_label) = lower($1) then 0
              else 1
            end as match_rank
       from cell_marker_panels
      where cell_type_curie = $1
         or lower(cell_type_label) = lower($1)
         or lower(cell_type_label) like '%' || lower($1) || '%'
         or lower($1) like '%' || lower(cell_type_label) || '%'
      order by match_rank asc, gene_symbol asc nulls last`,
    [key]
  );

  return rows.map((r) => ({
    cellTypeCurie: r.cell_type_curie,
    cellTypeLabel: r.cell_type_label,
    geneCurie: r.gene_curie,
    geneSymbol: r.gene_symbol,
    direction: r.direction,
    tissueCurie: r.tissue_curie,
    source: r.source,
    pmid: r.pmid,
  }));
}

// ---------------------------------------------------------------------------
// getSignature — a named gene set by its stable signature_id. Returns null on a miss.
// ---------------------------------------------------------------------------

export async function getSignature(
  pool: Pool,
  signatureId: string
): Promise<GeneSignature | null> {
  const key = signatureId.trim();
  if (key.length === 0) return null;

  const { rows } = await pool.query<{
    signature_id: string;
    name: string | null;
    source: string | null;
    gene_symbols: string[] | null;
    provenance: string | null;
  }>(
    `select signature_id, name, source, gene_symbols, provenance
       from gene_signatures
      where signature_id = $1
      limit 1`,
    [key]
  );

  const row = rows[0];
  if (!row) return null;
  return {
    signatureId: row.signature_id,
    name: row.name,
    source: row.source,
    geneSymbols: row.gene_symbols ?? [],
    provenance: row.provenance,
  };
}

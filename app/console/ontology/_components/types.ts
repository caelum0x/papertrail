// Client-side view types for the ontology-resolution console.
//
// CanonicalEntity mirrors the deterministic resolver contract
// (lib/entities/canonicalize.ts): a synonym-exact match returns the CURIE +
// canonical label + ontology + term type + score + xrefs, and a miss returns
// null. MarkerPanel mirrors the curated cell_marker_panels rows returned by
// /api/bio/marker-check. Nothing here is inferred; a null resolution and an
// empty panel set are honest, first-class states.

export interface CanonicalEntity {
  curie: string;
  canonicalLabel: string;
  ontology: string;
  termType: string | null;
  score: number;
  xrefs: string[];
}

export interface MarkerPanel {
  id?: string;
  cellTypeCurie?: string | null;
  cellTypeLabel?: string | null;
  geneCurie?: string | null;
  geneSymbol?: string | null;
  direction?: string | null;
  tissueCurie?: string | null;
  tissueLabel?: string | null;
  source?: string | null;
  pmid?: string | null;
}

export interface MarkerCheckResult {
  panels: MarkerPanel[];
}

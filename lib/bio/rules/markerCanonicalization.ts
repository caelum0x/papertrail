// MARKER CANONICALIZATION rule engine.
//
// Given a claimed set of marker genes + a claimed cell type, this engine answers,
// PER GENE and DETERMINISTICALLY: is this gene a registered marker for that cell type,
// and if so, in the direction the claim implies?
//
// MOAT: entity linking is done by the deterministic ontology canonicalizer
// (lib/entities/canonicalize.ts) — NO LLM. Marker membership + direction come from the
// PUBLIC cell_marker_panels table (curated single-cell reference panels), queried with
// parameterized SQL. Nothing is inferred: a gene that doesn't resolve, or resolves but
// isn't in the panel for the claimed cell type, yields an honest miss, never a guess.
//
// Signal per gene (rolled into ONE engine-level signal by the verifier):
//   positive   — the canonical gene IS a registered marker for the cell type, in a
//                consistent (or unspecified) direction.
//   overstated — the gene resolves but is NOT a marker for the claimed cell type, OR is
//                registered with the OPPOSITE direction (a negative marker claimed as a
//                positive marker). The claim asserts marker status the panel doesn't back.
//   empty      — the gene surface form did not resolve to any canonical ontology term
//                (honest "couldn't link"), or no cell type was claimed to check against.

import type { Pool } from "pg";
import {
  resolveEntity,
  resolveMany,
  type CanonicalEntity,
} from "@/lib/entities/canonicalize";
import type {
  CanonicalizedMarker,
  FindingSignal,
} from "@/lib/bio/bioinformatics.schemas";

// One curated marker-panel row for a cell type: a gene and (optionally) the direction
// in which it marks that cell type. Mirrors the cell_marker_panels schema columns we use.
export interface MarkerPanelEntry {
  cellTypeCurie: string | null;
  cellTypeLabel: string | null;
  geneCurie: string | null;
  geneSymbol: string | null;
  direction: string | null; // 'positive' | 'negative' | null (unspecified)
  source: string | null;
  pmid: string | null;
}

// The DB surface for this engine, injectable so the whole rule runs OFFLINE in tests
// against a stubbed panel loader + a stubbed canonicalizer.
export interface MarkerDeps {
  // Load the curated marker panel for a cell type. Resolves the cell type to a canonical
  // ontology term first (deterministically), then reads cell_marker_panels.
  getMarkersForCellType: (cellType: string) => Promise<MarkerPanelEntry[]>;
  // Resolve many gene surface forms to canonical entities (deterministic ontology match).
  resolveGenes: (surfaces: string[]) => Promise<Array<CanonicalEntity | null>>;
}

// --- Default deps (real DB + real canonicalizer) --------------------------------

// Normalize a direction string to our lowercase vocabulary, or null when absent/unknown.
function normalizeDirection(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.trim().toLowerCase();
  if (d === "positive" || d === "up" || d === "+") return "positive";
  if (d === "negative" || d === "down" || d === "-") return "negative";
  return null;
}

/**
 * Load the curated marker panel for a cell type from cell_marker_panels. The cell type
 * is first resolved to a canonical CURIE (deterministic ontology match); we then match
 * panel rows by cell_type_curie when we have one, else fall back to a case-insensitive
 * label match. Returns [] when the cell type doesn't resolve to any panel (honest empty).
 * Parameterized SQL only. PUBLIC table (no org scoping), per the bio_cache precedent.
 */
export async function getMarkersForCellType(
  pool: Pool,
  cellType: string,
  resolve: (
    surface: string,
    type?: string
  ) => Promise<CanonicalEntity | null> = defaultResolveOne(pool)
): Promise<MarkerPanelEntry[]> {
  const surface = cellType.trim();
  if (surface.length === 0) return [];

  const canonical = await resolve(surface, "cell_type").catch(() => null);

  // Prefer an exact canonical-CURIE match; otherwise fall back to a normalized label
  // match so a curated panel keyed only by label is still found. Both are parameterized.
  const { rows } = canonical?.curie
    ? await pool.query(
        `select cell_type_curie, cell_type_label, gene_curie, gene_symbol,
                direction, source, pmid
           from cell_marker_panels
          where cell_type_curie = $1`,
        [canonical.curie]
      )
    : await pool.query(
        `select cell_type_curie, cell_type_label, gene_curie, gene_symbol,
                direction, source, pmid
           from cell_marker_panels
          where lower(cell_type_label) = lower($1)`,
        [surface]
      );

  return rows.map((r: Record<string, unknown>) => ({
    cellTypeCurie: (r.cell_type_curie as string | null) ?? null,
    cellTypeLabel: (r.cell_type_label as string | null) ?? null,
    geneCurie: (r.gene_curie as string | null) ?? null,
    geneSymbol: (r.gene_symbol as string | null) ?? null,
    direction: normalizeDirection((r.direction as string | null) ?? null),
    source: (r.source as string | null) ?? null,
    pmid: (r.pmid as string | null) ?? null,
  }));
}

function defaultResolveOne(pool: Pool) {
  return (surface: string, type?: string): Promise<CanonicalEntity | null> =>
    resolveEntity(pool, surface, type);
}

export function defaultMarkerDeps(pool: Pool): MarkerDeps {
  return {
    getMarkersForCellType: (cellType) => getMarkersForCellType(pool, cellType),
    resolveGenes: async (surfaces) => resolveMany(pool, surfaces, "gene"),
  };
}

// --- Deterministic per-gene classification --------------------------------------

// Compare a canonical gene against the panel. A gene matches a panel entry by canonical
// CURIE when both carry one, else by case-insensitive symbol. Returns the matched entry
// (the one that decides marker status/direction) or null when the gene isn't in the panel.
function findPanelEntry(
  gene: CanonicalEntity,
  panel: MarkerPanelEntry[]
): MarkerPanelEntry | null {
  const geneCurie = gene.curie;
  const geneLabel = gene.canonicalLabel.trim().toLowerCase();
  for (const entry of panel) {
    if (geneCurie && entry.geneCurie && entry.geneCurie === geneCurie) return entry;
    if (
      entry.geneSymbol &&
      entry.geneSymbol.trim().toLowerCase() === geneLabel
    ) {
      return entry;
    }
  }
  return null;
}

// The direction a MARKER claim implies. Claiming a gene as a "marker" of a cell type
// asserts a POSITIVE marker (it is expressed in / identifies that cell type). A panel
// entry registered as `negative` therefore CONTRADICTS a positive-marker claim.
const CLAIMED_MARKER_DIRECTION = "positive";

export interface MarkerGeneResult {
  marker: CanonicalizedMarker;
  signal: FindingSignal;
  reason: string;
}

/**
 * Classify ONE resolved gene against the cell-type panel. PURE — no DB, no LLM.
 *   - gene didn't resolve                       → empty  ("couldn't link")
 *   - resolved, in panel, direction consistent  → positive
 *   - resolved, in panel, OPPOSITE direction    → overstated (negative marker claimed +)
 *   - resolved, NOT in panel for this cell type  → overstated (marker status unbacked)
 */
export function classifyMarkerGene(
  surface: string,
  gene: CanonicalEntity | null,
  panel: MarkerPanelEntry[],
  cellTypeLabel: string
): MarkerGeneResult {
  if (gene === null) {
    return {
      marker: {
        surface,
        curie: null,
        canonicalLabel: null,
        isMarker: false,
        markerDirection: null,
      },
      signal: "empty",
      reason: `"${surface}" did not resolve to a canonical gene in the ontology, so its marker status for ${cellTypeLabel} could not be checked.`,
    };
  }

  const entry = findPanelEntry(gene, panel);
  if (!entry) {
    return {
      marker: {
        surface,
        curie: gene.curie,
        canonicalLabel: gene.canonicalLabel,
        isMarker: false,
        markerDirection: null,
      },
      signal: "overstated",
      reason: `${gene.canonicalLabel} is not a registered marker of ${cellTypeLabel} in the curated cell-marker panels; the claim overstates its marker status.`,
    };
  }

  // In the panel. If the registered direction contradicts the implied positive-marker
  // claim, the claim overstates (a negative marker presented as identifying the type).
  if (
    entry.direction !== null &&
    entry.direction !== CLAIMED_MARKER_DIRECTION
  ) {
    return {
      marker: {
        surface,
        curie: gene.curie,
        canonicalLabel: gene.canonicalLabel,
        isMarker: true,
        markerDirection: entry.direction,
      },
      signal: "overstated",
      reason: `${gene.canonicalLabel} is registered as a ${entry.direction} marker of ${cellTypeLabel}, which contradicts its use as a positive identifying marker.`,
    };
  }

  return {
    marker: {
      surface,
      curie: gene.curie,
      canonicalLabel: gene.canonicalLabel,
      isMarker: true,
      markerDirection: entry.direction,
    },
    signal: "positive",
    reason: `${gene.canonicalLabel} is a registered${
      entry.direction ? ` ${entry.direction}` : ""
    } marker of ${cellTypeLabel} in the curated panels.`,
  };
}

export interface MarkerCanonicalizationResult {
  cellType: string | null;
  cellTypeMatched: boolean;
  genes: MarkerGeneResult[];
  canonicalizedMarkers: CanonicalizedMarker[];
  // The single rolled-up engine signal (see combineMarkerSignal).
  signal: FindingSignal;
  summary: string;
}

/**
 * Roll the per-gene signals into ONE engine signal, PURE and documented:
 *   - no genes checkable (all empty / none provided / no cell type) → empty
 *   - any gene overstated                                           → overstated
 *   - at least one positive, none overstated                        → positive
 * Overstatement dominates (the dangerous direction), matching the biomedical verifier.
 */
export function combineMarkerSignal(
  genes: MarkerGeneResult[],
  cellTypeMatched: boolean
): FindingSignal {
  const nonEmpty = genes.filter((g) => g.signal !== "empty");
  if (!cellTypeMatched || nonEmpty.length === 0) return "empty";
  if (nonEmpty.some((g) => g.signal === "overstated")) return "overstated";
  if (nonEmpty.some((g) => g.signal === "positive")) return "positive";
  return "empty";
}

/**
 * Verify a claimed marker-gene set against a claimed cell type. DETERMINISTIC end-to-end:
 * resolve genes via the ontology canonicalizer, load the curated panel for the cell type,
 * classify each gene, and roll up. Offline-testable via injected deps. On any failure the
 * engine degrades to an honest empty result rather than a fabricated verdict.
 */
export async function verifyMarkerCanonicalization(
  input: { markerGenes: string[]; cellType: string | null },
  deps: MarkerDeps
): Promise<MarkerCanonicalizationResult> {
  const cellType = input.cellType?.trim() || null;
  const surfaces = input.markerGenes
    .map((g) => g.trim())
    .filter((g) => g.length > 0);

  // No cell type or no genes → nothing to check (honest empty).
  if (cellType === null || surfaces.length === 0) {
    return {
      cellType,
      cellTypeMatched: false,
      genes: [],
      canonicalizedMarkers: [],
      signal: "empty",
      summary:
        cellType === null
          ? "No cell type was claimed, so marker membership could not be checked."
          : "No marker genes were claimed to check against the cell type.",
    };
  }

  const [panel, resolved] = await Promise.all([
    deps.getMarkersForCellType(cellType).catch(() => [] as MarkerPanelEntry[]),
    deps.resolveGenes(surfaces).catch(
      () => surfaces.map(() => null) as Array<CanonicalEntity | null>
    ),
  ]);

  const cellTypeMatched = panel.length > 0;
  const cellTypeLabel = panel[0]?.cellTypeLabel?.trim() || cellType;

  const genes = surfaces.map((surface, i) =>
    classifyMarkerGene(surface, resolved[i] ?? null, panel, cellTypeLabel)
  );
  const canonicalizedMarkers = genes.map((g) => g.marker);
  const signal = combineMarkerSignal(genes, cellTypeMatched);

  const positives = genes.filter((g) => g.signal === "positive").length;
  const overstated = genes.filter((g) => g.signal === "overstated").length;
  const unresolved = genes.filter((g) => g.signal === "empty").length;

  const summary = !cellTypeMatched
    ? `No curated marker panel was found for "${cellType}", so the ${surfaces.length} claimed marker gene(s) could not be checked.`
    : `Checked ${surfaces.length} claimed marker gene(s) against the curated panel for ${cellTypeLabel}: ` +
      `${positives} confirmed marker(s), ${overstated} not a registered marker or wrong direction, ` +
      `${unresolved} unresolved.`;

  return {
    cellType,
    cellTypeMatched,
    genes,
    canonicalizedMarkers,
    signal,
    summary,
  };
}

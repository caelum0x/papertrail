import "dotenv/config";
import { getPool } from "../lib/db";
import {
  ONTOLOGY_TERMS,
  ONTOLOGY_EDGES,
  CELL_MARKER_PANELS,
  GENE_SIGNATURES,
  type OntologyTermSeed,
} from "../lib/bio/ontologyData";

// Idempotent, CACHE-ONCE ingestion of the curated ontology + marker reference
// (lib/bio/ontologyData.ts) into the 0062_bio-ontology.sql tables. NO live network fetch:
// the seed is hand-curated open-database/literature data shipped in-repo, transcribed by
// hand (never LLM-generated), which is what makes the resolved identities reproducible.
//
// Every write is upsert-safe (on conflict do nothing / do update), so re-running is a
// no-op that refreshes labels rather than duplicating rows. Coverage counts are printed at
// the end so the honest gap of a curated (not full-dump) reference is always visible.

// The canonicalizer matches on a normalized synonym: lower-cased, whitespace-collapsed.
// The ingest MUST normalize identically, or a synonym seeded here would never match a
// runtime surface form. Mirrors the normalization in lib/entities/canonicalize.ts.
function normalizeSurface(surface: string): string {
  return surface.trim().toLowerCase().replace(/\s+/g, " ");
}

// Build the full synonym set for a term: its label plus every listed synonym, all
// normalized and de-duplicated so we don't insert redundant rows.
function synonymRows(term: OntologyTermSeed): Array<{ norm: string; source: string }> {
  const byNorm = new Map<string, string>();
  const add = (raw: string, source: string) => {
    const norm = normalizeSurface(raw);
    if (norm.length === 0) return;
    if (!byNorm.has(norm)) byNorm.set(norm, source);
  };
  add(term.label, "label");
  for (const s of term.synonyms) add(s, "curated");
  return Array.from(byNorm.entries()).map(([norm, source]) => ({ norm, source }));
}

async function main() {
  const pool = getPool();
  const client = await pool.connect();

  const counts = {
    terms: 0,
    synonyms: 0,
    xrefs: 0,
    edges: 0,
    markers: 0,
    signatures: 0,
  };

  try {
    await client.query("begin");

    // --- ontology_terms + synonyms + xrefs ---------------------------------
    for (const term of ONTOLOGY_TERMS) {
      await client.query(
        `insert into ontology_terms (curie, ontology, label, term_type, obsolete, replaced_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (curie) do update
           set ontology = excluded.ontology,
               label = excluded.label,
               term_type = excluded.term_type,
               obsolete = excluded.obsolete,
               replaced_by = excluded.replaced_by`,
        [
          term.curie,
          term.ontology,
          term.label,
          term.termType,
          term.obsolete ?? false,
          term.replacedBy ?? null,
        ]
      );
      counts.terms += 1;

      // Refresh synonyms deterministically: clear this term's rows, re-insert the
      // normalized set. Keeps the table an exact reflection of the seed (idempotent).
      await client.query(`delete from ontology_synonyms where curie = $1`, [term.curie]);
      for (const syn of synonymRows(term)) {
        await client.query(
          `insert into ontology_synonyms (curie, synonym_norm, source) values ($1, $2, $3)`,
          [term.curie, syn.norm, syn.source]
        );
        counts.synonyms += 1;
      }

      // Same for xrefs.
      await client.query(`delete from ontology_xrefs where curie = $1`, [term.curie]);
      for (const xref of term.xrefs) {
        await client.query(
          `insert into ontology_xrefs (curie, xref_curie) values ($1, $2)`,
          [term.curie, xref]
        );
        counts.xrefs += 1;
      }
    }

    // --- ontology_edges (marker backbone) ----------------------------------
    // No natural key on this thin table; wipe + re-insert the derived edge set so the
    // ingest stays fully idempotent.
    await client.query(`delete from ontology_edges where predicate = $1`, ["has_marker"]);
    for (const edge of ONTOLOGY_EDGES) {
      await client.query(
        `insert into ontology_edges (subject_curie, predicate, object_curie) values ($1, $2, $3)`,
        [edge.subjectCurie, edge.predicate, edge.objectCurie]
      );
      counts.edges += 1;
    }

    // --- cell_marker_panels ------------------------------------------------
    // The panels have a uuid pk with no natural unique key; re-seeding by (source) keeps
    // the operation idempotent without duplicating the curated set on re-run.
    const markerSources = Array.from(new Set(CELL_MARKER_PANELS.map((m) => m.source)));
    await client.query(
      `delete from cell_marker_panels where source = any($1::text[])`,
      [markerSources]
    );
    for (const m of CELL_MARKER_PANELS) {
      await client.query(
        `insert into cell_marker_panels
           (cell_type_curie, cell_type_label, gene_curie, gene_symbol, direction, tissue_curie, source, pmid)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          m.cellTypeCurie,
          m.cellTypeLabel,
          m.geneCurie,
          m.geneSymbol,
          m.direction,
          m.tissueCurie,
          m.source,
          m.pmid,
        ]
      );
      counts.markers += 1;
    }

    // --- gene_signatures ---------------------------------------------------
    for (const sig of GENE_SIGNATURES) {
      await client.query(
        `insert into gene_signatures (signature_id, name, source, gene_symbols, provenance)
         values ($1, $2, $3, $4, $5)
         on conflict (signature_id) do update
           set name = excluded.name,
               source = excluded.source,
               gene_symbols = excluded.gene_symbols,
               provenance = excluded.provenance`,
        [sig.signatureId, sig.name, sig.source, sig.geneSymbols, sig.provenance]
      );
      counts.signatures += 1;
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // Coverage report — the honest ledger of what this curated seed does (and does not) cover.
  const byType = new Map<string, number>();
  for (const t of ONTOLOGY_TERMS) {
    byType.set(t.termType, (byType.get(t.termType) ?? 0) + 1);
  }
  const cellTypes = new Set(CELL_MARKER_PANELS.map((m) => m.cellTypeLabel)).size;

  console.log("\nOntology ingest complete (curated starter seed).");
  console.log(`  ontology_terms      : ${counts.terms}`);
  for (const [type, n] of Array.from(byType.entries()).sort()) {
    console.log(`      - ${type.padEnd(10)}: ${n}`);
  }
  console.log(`  ontology_synonyms   : ${counts.synonyms}`);
  console.log(`  ontology_xrefs      : ${counts.xrefs}`);
  console.log(`  ontology_edges      : ${counts.edges} (has_marker)`);
  console.log(`  cell_marker_panels  : ${counts.markers} rows across ${cellTypes} cell type(s)`);
  console.log(`  gene_signatures     : ${counts.signatures}`);
  console.log(
    "\nNote: this is a CURATED subset, not the full HGNC/EFO/MONDO/ChEMBL/CellMarker dumps. " +
      "Surface forms outside this seed will honestly return no canonical match."
  );

  await pool.end();
}

main().catch((err) => {
  console.error("Ontology ingestion failed:", err);
  process.exit(1);
});

// ClinVar ingest driver — wraps lib/bio/variantPathogenicity.lookupVariant into cacheable
// source records (one per returned ClinVar interpretation).
//
// ClinVar is keyed by a variant identifier. This driver resolves the query key from the
// context in specificity order: the entity CURIE/surface when it looks like an rsID or an
// HGVS/gene, else the free-text query as a gene/variant term. When nothing resolvable is
// present, or ClinVar returns no records, it returns [] (honest empty) — never a
// fabricated interpretation. NO LLM; the star ratings + significance are exactly what
// ClinVar's E-utilities returned (public-domain data).

import { lookupVariant } from "@/lib/bio/variantPathogenicity";
import type { ClinVarVariantRecord } from "@/lib/bio/variant.schemas";
import type { CacheableSourceRecord, DriverContext, IngestDriver } from "./types";

const SOURCE_TYPE = "clinvar";
const LICENSE = "NCBI ClinVar (public domain).";

// rsID pattern: "rs" followed by digits (dbSNP). Gene/HGVS are free text.
const RSID_RE = /^rs\d+$/i;

interface VariantQuery {
  rsId?: string;
  hgvs?: string;
  gene?: string;
}

// Decide the most specific ClinVar lookup key from the context. An rsID or HGVS is
// variant-specific; a plain symbol is treated as a gene. Returns null when nothing usable.
function resolveQuery(context: DriverContext): VariantQuery | null {
  const candidates = [context.entitySurface, context.entityCurie, context.query]
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter((c) => c.length > 0);

  for (const c of candidates) {
    if (RSID_RE.test(c)) return { rsId: c };
  }
  // An HGVS expression contains a ':' or 'p.'/'c.' — treat as HGVS.
  for (const c of candidates) {
    if (c.includes(":") || /\b[pcgn]\.\S+/.test(c)) return { hgvs: c };
  }
  // A gene-typed entity, or the first candidate as a gene symbol.
  if (context.entityType === "gene" && context.entitySurface) {
    return { gene: context.entitySurface.trim() };
  }
  if (candidates.length > 0) return { gene: candidates[0] };
  return null;
}

// A stable, cache-once external id for a ClinVar record. Prefers the record's own
// variant/accession string; falls back to the query key so distinct queries don't collide.
function externalIdFor(record: ClinVarVariantRecord, queryKey: string, index: number): string {
  const base = record.variant?.trim();
  if (base && base.length > 0) return base;
  return `${queryKey}#${index}`;
}

export const clinvarDriver: IngestDriver = {
  sourceType: SOURCE_TYPE,
  async fetch(context: DriverContext): Promise<CacheableSourceRecord[]> {
    const query = resolveQuery(context);
    if (!query) return [];

    const records = await lookupVariant(query).catch(() => [] as ClinVarVariantRecord[]);
    if (records.length === 0) return [];

    const queryKey = (query.rsId ?? query.hgvs ?? query.gene ?? "clinvar").toLowerCase();
    const capped = records.slice(0, Math.max(1, context.limit));

    return capped.map((record, index) => {
      const externalId = externalIdFor(record, queryKey, index);
      const significance = record.clinicalSignificance ?? record.rawSignificance ?? "not classified";
      const condition = record.condition ?? "unspecified condition";
      const rawText =
        `ClinVar interpretation for ${record.variant ?? externalId}: ` +
        `${significance} for ${condition} ` +
        `(review status "${record.reviewStatus ?? "unknown"}", ${record.starRating}-star).`;

      return {
        source_type: SOURCE_TYPE,
        external_id: externalId,
        title: `ClinVar: ${record.variant ?? externalId}`,
        raw_text: rawText,
        url: `https://www.ncbi.nlm.nih.gov/clinvar/?term=${encodeURIComponent(externalId)}`,
        metadata: {
          license: LICENSE,
          sourceVersion: "ClinVar E-utilities",
          variantId: query.rsId ?? record.variant ?? null,
          extra: {
            clinicalSignificance: record.clinicalSignificance,
            rawSignificance: record.rawSignificance,
            condition: record.condition,
            reviewStatus: record.reviewStatus,
            starRating: record.starRating,
            queryKey,
          },
        },
      };
    });
  },
};

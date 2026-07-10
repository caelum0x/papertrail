// Genetic-association verification against the EBI GWAS Catalog + NCBI ClinVar.
//
// PaperTrail's moat is DETERMINISTIC biology on real data with NO LLM in the numeric
// loop. This module answers one question about a claim like "variant rs123 in GENE is
// associated with DISEASE": do the field-standard genetics databases actually SUPPORT
// that, at the field-standard significance thresholds — or not? The verdict is a pure
// function of what the APIs returned; nothing is inferred or fabricated.
//
// Every network call goes through a small INJECTABLE fetcher (GeneticDeps) mirroring
// lib/ingest/searchAndCache.ts, so the tests run fully offline with a mocked fetch.
// On any upstream failure we return an honest EMPTY result (no association / no record)
// rather than a made-up number — a wrong "confident" genetic call is worse than an
// honest "couldn't verify" (CLAUDE.md no_support_found principle, applied to genetics).

import {
  GwasAssociation,
  ClinVarRecord,
  GeneticAssociationResult,
  GeneticVerdict,
} from "./genetics.schemas";

// --- Field-standard significance constants -------------------------------------
//
// GENOME_WIDE_SIGNIFICANCE (p <= 5e-8) is the community-standard Bonferroni-style
// threshold for ~1M independent common variants across the genome (0.05 / 1e6),
// established for GWAS since Pe'er et al. 2008 / Dudbridge & Gusnanto 2008 and used
// by the GWAS Catalog itself. SUGGESTIVE (p <= 1e-5) is the widely-used lower bar for
// loci worth follow-up but not genome-wide significant. These are CONSTANTS, not tuned.
export const GENOME_WIDE_SIGNIFICANCE = 5e-8;
export const SUGGESTIVE_SIGNIFICANCE = 1e-5;

// ClinVar clinical-significance strings that count as pathogenic evidence. Matched
// case-insensitively as substrings so "Pathogenic", "Likely pathogenic", and combined
// assertions ("Pathogenic/Likely pathogenic") all qualify.
const PATHOGENIC_MARKERS = ["pathogenic"] as const;
const BENIGN_MARKERS = ["benign"] as const;

const GWAS_BASE = "https://www.ebi.ac.uk/gwas/rest/api";
const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RECORDS = 50;

// The only side-effecting surface: a fetch-like function. Defaults to global fetch;
// tests inject a stub so no real network call is made. Kept minimal on purpose.
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface GeneticDeps {
  fetch: FetchLike;
  timeoutMs?: number;
}

const defaultDeps: GeneticDeps = {
  fetch: (url, init) => fetch(url, init),
  timeoutMs: DEFAULT_TIMEOUT_MS,
};

// --- Small safe helpers --------------------------------------------------------

function asString(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Run a fetch with a timeout + JSON parse, converting ANY failure (network, non-2xx,
// bad JSON, abort) into `null`. Callers treat null as "this source returned nothing",
// never as an error to surface a fabricated verdict.
async function fetchJsonSafe(
  deps: GeneticDeps,
  url: string
): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// GWAS Catalog HAL responses nest the useful list under _embedded.<key>. Pull the
// first array found there defensively — the key varies by endpoint (associations,
// singleNucleotidePolymorphisms, studies), and a missing envelope yields [].
function extractEmbeddedArray(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const embedded = (payload as Record<string, unknown>)._embedded;
  if (!embedded || typeof embedded !== "object") return [];
  for (const value of Object.values(embedded as Record<string, unknown>)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

// --- GWAS Catalog --------------------------------------------------------------

// Reassemble a real p-value from the GWAS Catalog's split representation
// (pvalueMantissa * 10^pvalueExponent), falling back to a plain `pvalue` field.
// Returns null when neither is usable so the record is kept but not treated as
// significant on a fabricated number.
function extractPValue(assoc: Record<string, unknown>): number | null {
  const mantissa = asFiniteNumber(assoc.pvalueMantissa);
  const exponent = asFiniteNumber(assoc.pvalueExponent);
  if (mantissa !== null && exponent !== null) {
    const p = mantissa * 10 ** exponent;
    return Number.isFinite(p) ? p : null;
  }
  return asFiniteNumber(assoc.pvalue);
}

// The GWAS Catalog nests gene, rsID, and trait one or two levels down under `loci`
// and `_links`. We read them defensively; any missing field becomes null rather than
// throwing, so a partial record still contributes what it does have.
function normalizeGwasAssociation(raw: unknown): GwasAssociation {
  const assoc = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // rsID + risk allele live under loci[].strongestRiskAlleles[].riskAlleleName,
  // formatted "rs123-A". Gene lives under loci[].authorReportedGenes[].geneName.
  let rsId: string | null = null;
  let riskAllele: string | null = null;
  let gene: string | null = null;

  const loci = Array.isArray(assoc.loci) ? assoc.loci : [];
  for (const locus of loci) {
    const l = (locus && typeof locus === "object" ? locus : {}) as Record<string, unknown>;
    const risk = Array.isArray(l.strongestRiskAlleles) ? l.strongestRiskAlleles : [];
    for (const r of risk) {
      const name = asString((r as Record<string, unknown>)?.riskAlleleName);
      if (name && !riskAllele) {
        riskAllele = name;
        const [rs] = name.split("-");
        if (rs && !rsId) rsId = rs.trim() || null;
      }
    }
    const genes = Array.isArray(l.authorReportedGenes) ? l.authorReportedGenes : [];
    for (const g of genes) {
      const gn = asString((g as Record<string, unknown>)?.geneName);
      if (gn && !gene) gene = gn;
    }
  }

  const trait =
    asString(assoc.traitName) ??
    (Array.isArray(assoc.efoTraits)
      ? asString((assoc.efoTraits[0] as Record<string, unknown>)?.trait)
      : null);

  const study =
    asString(assoc.pubmedId) ??
    asString(assoc.accessionId) ??
    (assoc.study && typeof assoc.study === "object"
      ? asString((assoc.study as Record<string, unknown>).accessionId)
      : null);

  return {
    rsId,
    gene,
    trait,
    pValue: extractPValue(assoc),
    orBeta: asFiniteNumber(assoc.orPerCopyNum) ?? asFiniteNumber(assoc.betaNum),
    riskAllele,
    study,
  };
}

// Which GWAS Catalog search endpoint to hit, keyed by the most specific locus
// identifier available. Variant (rsID) is most specific, then gene, then free-text
// trait. Returns null when there's nothing to search on.
function buildGwasUrl(query: {
  gene?: string;
  variant?: string;
  trait?: string;
}): string | null {
  const size = `size=${MAX_RECORDS}`;
  if (query.variant) {
    return `${GWAS_BASE}/singleNucleotidePolymorphisms/${encodeURIComponent(
      query.variant
    )}/associations?${size}`;
  }
  if (query.gene) {
    return `${GWAS_BASE}/associations/search/findByGene?geneName=${encodeURIComponent(
      query.gene
    )}&${size}`;
  }
  if (query.trait) {
    return `${GWAS_BASE}/associations/search/findByEfoTrait?efoTrait=${encodeURIComponent(
      query.trait
    )}&${size}`;
  }
  return null;
}

/**
 * Query the EBI GWAS Catalog for associations at a gene, variant, or trait. Returns
 * normalized association records — or an empty array when nothing is found or the API
 * is unavailable (never a fabricated hit). Offline-testable via injected deps.fetch.
 */
export async function queryGwasCatalog(
  query: { gene?: string; variant?: string; trait?: string },
  deps: GeneticDeps = defaultDeps
): Promise<GwasAssociation[]> {
  const url = buildGwasUrl(query);
  if (!url) return [];

  const payload = await fetchJsonSafe(deps, url);
  if (payload === null) return [];

  const rows = extractEmbeddedArray(payload);
  return rows.slice(0, MAX_RECORDS).map(normalizeGwasAssociation);
}

// --- ClinVar (NCBI E-utilities) ------------------------------------------------

function buildClinVarTerm(query: { gene?: string; variant?: string }): string | null {
  if (query.variant) return `${query.variant}[Variant name]`;
  if (query.gene) return `${query.gene}[gene]`;
  return null;
}

// Normalize one esummary result object (values keyed by uid) into a ClinVarRecord.
// The esummary "germline_classification"/"clinical_significance" shapes vary across
// ClinVar's schema versions, so we read both defensively.
function normalizeClinVarRecord(raw: unknown): ClinVarRecord {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const germline = (r.germline_classification && typeof r.germline_classification === "object"
    ? r.germline_classification
    : {}) as Record<string, unknown>;
  const legacy = (r.clinical_significance && typeof r.clinical_significance === "object"
    ? r.clinical_significance
    : {}) as Record<string, unknown>;

  const significance =
    asString(germline.description) ??
    asString(legacy.description) ??
    asString(r.clinical_significance);

  const reviewStatus =
    asString(germline.review_status) ??
    asString(legacy.review_status) ??
    asString(r.review_status);

  // Condition can be a trait_set array or a plain string field.
  let condition: string | null = null;
  const traitSet = Array.isArray(germline.trait_set)
    ? germline.trait_set
    : Array.isArray(r.trait_set)
      ? r.trait_set
      : [];
  for (const t of traitSet) {
    const name = asString((t as Record<string, unknown>)?.trait_name);
    if (name) {
      condition = name;
      break;
    }
  }
  if (!condition) condition = asString(r.condition);

  const variant = asString(r.title) ?? asString(r.variation_name) ?? asString(r.accession);

  return {
    variant,
    clinicalSignificance: significance,
    condition,
    reviewStatus,
  };
}

// The esummary "result" object is keyed by { uids: [...], <uid>: {...} }. Pull the
// per-uid record objects out in uid order.
function extractClinVarResults(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return [];
  const uids = (result as Record<string, unknown>).uids;
  if (!Array.isArray(uids)) return [];
  return uids
    .map((uid) => (result as Record<string, unknown>)[String(uid)])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

/**
 * Query NCBI ClinVar via E-utilities (esearch -> esummary) for interpretations of a
 * gene or variant. Returns normalized records, or an empty array on no match / API
 * failure. Offline-testable via injected deps.fetch. Never fabricates a record.
 */
export async function queryClinVar(
  query: { gene?: string; variant?: string },
  deps: GeneticDeps = defaultDeps
): Promise<ClinVarRecord[]> {
  const term = buildClinVarTerm(query);
  if (!term) return [];

  const esearchUrl = `${EUTILS_BASE}/esearch.fcgi?db=clinvar&term=${encodeURIComponent(
    term
  )}&retmode=json&retmax=${MAX_RECORDS}`;
  const searchPayload = await fetchJsonSafe(deps, esearchUrl);
  if (searchPayload === null) return [];

  const idlist = (() => {
    const sr = (searchPayload as Record<string, unknown>)?.esearchresult;
    const ids = sr && typeof sr === "object" ? (sr as Record<string, unknown>).idlist : null;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  })();
  if (idlist.length === 0) return [];

  const esummaryUrl = `${EUTILS_BASE}/esummary.fcgi?db=clinvar&id=${encodeURIComponent(
    idlist.slice(0, MAX_RECORDS).join(",")
  )}&retmode=json`;
  const summaryPayload = await fetchJsonSafe(deps, esummaryUrl);
  if (summaryPayload === null) return [];

  return extractClinVarResults(summaryPayload).map(normalizeClinVarRecord);
}

// --- Deterministic verdict -----------------------------------------------------

// Does a free-text disease query plausibly match a record's trait/condition string?
// Case-insensitive substring either direction. Deliberately permissive: GWAS traits
// and ClinVar conditions are free text ("type 2 diabetes mellitus" vs "diabetes").
// When either side is missing we do NOT match (can't claim disease-specificity).
function traitMatchesDisease(trait: string | null, disease: string): boolean {
  if (!trait) return false;
  const t = trait.toLowerCase();
  const d = disease.trim().toLowerCase();
  if (d.length === 0) return false;
  return t.includes(d) || d.includes(t);
}

function significanceContains(sig: string | null, markers: readonly string[]): boolean {
  if (!sig) return false;
  const s = sig.toLowerCase();
  return markers.some((m) => s.includes(m));
}

// The strongest GWAS p-value among associations whose trait matches the disease.
// Returns null when there are no disease-matched associations with a usable p-value.
function minMatchedPValue(gwas: GwasAssociation[], disease: string): number | null {
  let min: number | null = null;
  for (const a of gwas) {
    if (a.pValue === null) continue;
    if (!traitMatchesDisease(a.trait, disease)) continue;
    if (min === null || a.pValue < min) min = a.pValue;
  }
  return min;
}

/**
 * Verify a genetic association DETERMINISTICALLY from GWAS Catalog + ClinVar records.
 *
 * Verdict precedence (documented):
 *  1. genome_wide_significant  — any disease-matched GWAS hit with p <= 5e-8
 *  2. suggestive               — best disease-matched p in (5e-8, 1e-5]
 *  3. clinvar_pathogenic       — a ClinVar (Likely) Pathogenic record for the disease,
 *                                with no genome-wide/suggestive GWAS support
 *  4. conflicting              — ClinVar reports BOTH pathogenic and benign for the
 *                                disease (curator disagreement), no significant GWAS
 *  5. reported_not_significant — GWAS returned disease-matched associations but the
 *                                best p is > 1e-5 (an association was reported, just
 *                                not at a genome-wide/suggestive bar)
 *  6. no_association_found     — neither source returned disease-matched evidence
 *
 * The result carries ONLY the records the APIs returned; `minPValue` is the exact
 * driving value, for auditability. No LLM, no randomness — same inputs, same verdict.
 */
export function classifyGeneticAssociation(input: {
  disease: string;
  gene: string | null;
  variant: string | null;
  gwas: GwasAssociation[];
  clinvar: ClinVarRecord[];
}): GeneticAssociationResult {
  const { disease, gene, variant, gwas, clinvar } = input;

  const minP = minMatchedPValue(gwas, disease);

  // ClinVar disease-matched pathogenic / benign signals.
  const matchedClinVar = clinvar.filter((c) => traitMatchesDisease(c.condition, disease));
  const hasPathogenic = matchedClinVar.some((c) =>
    significanceContains(c.clinicalSignificance, PATHOGENIC_MARKERS)
  );
  const hasBenign = matchedClinVar.some(
    (c) =>
      significanceContains(c.clinicalSignificance, BENIGN_MARKERS) &&
      !significanceContains(c.clinicalSignificance, PATHOGENIC_MARKERS)
  );

  const thresholds = {
    genomeWideSignificant: GENOME_WIDE_SIGNIFICANCE,
    suggestive: SUGGESTIVE_SIGNIFICANCE,
  };

  const base = {
    disease,
    gene,
    variant,
    minPValue: minP,
    thresholds,
    supporting: { gwas, clinvar },
  };

  let verdict: GeneticVerdict;
  let rationale: string;

  if (minP !== null && minP <= GENOME_WIDE_SIGNIFICANCE) {
    verdict = "genome_wide_significant";
    rationale = `A disease-matched GWAS association reached p=${minP.toExponential(
      2
    )} ≤ ${GENOME_WIDE_SIGNIFICANCE.toExponential(0)} (genome-wide significance).`;
  } else if (minP !== null && minP <= SUGGESTIVE_SIGNIFICANCE) {
    verdict = "suggestive";
    rationale = `Best disease-matched GWAS association is p=${minP.toExponential(
      2
    )}, within the suggestive range (${GENOME_WIDE_SIGNIFICANCE.toExponential(
      0
    )} < p ≤ ${SUGGESTIVE_SIGNIFICANCE.toExponential(0)}).`;
  } else if (hasPathogenic && hasBenign) {
    verdict = "conflicting";
    rationale =
      "ClinVar contains both pathogenic and benign interpretations for this locus and disease; the clinical evidence is conflicting.";
  } else if (hasPathogenic) {
    verdict = "clinvar_pathogenic";
    rationale =
      "ClinVar reports a (Likely) Pathogenic clinical interpretation for this locus and disease.";
  } else if (minP !== null) {
    verdict = "reported_not_significant";
    rationale = `GWAS reported a disease-matched association, but the best p=${minP.toExponential(
      2
    )} does not reach the suggestive threshold (${SUGGESTIVE_SIGNIFICANCE.toExponential(0)}).`;
  } else {
    verdict = "no_association_found";
    rationale =
      "Neither the GWAS Catalog nor ClinVar returned a disease-matched association for this locus.";
  }

  return { verdict, rationale, ...base };
}

/**
 * End-to-end genetic-association verification: query both databases for the given
 * locus, then classify the combined evidence deterministically. Each source is
 * queried independently and a failing source degrades to an empty list (honest empty
 * result) rather than sinking the other — mirroring the searchAndCache resilience.
 */
export async function verifyGeneticAssociation(
  request: { gene?: string; variant?: string; disease: string },
  deps: GeneticDeps = defaultDeps
): Promise<GeneticAssociationResult> {
  const gene = request.gene?.trim() || undefined;
  const variant = request.variant?.trim() || undefined;
  const disease = request.disease.trim();

  const [gwas, clinvar] = await Promise.all([
    queryGwasCatalog({ gene, variant, trait: disease }, deps).catch(() => [] as GwasAssociation[]),
    queryClinVar({ gene, variant }, deps).catch(() => [] as ClinVarRecord[]),
  ]);

  return classifyGeneticAssociation({
    disease,
    gene: gene ?? null,
    variant: variant ?? null,
    gwas,
    clinvar,
  });
}

// VARIANT PATHOGENICITY verification against NCBI ClinVar (public domain).
//
// PaperTrail's moat is DETERMINISTIC biology on real data with NO LLM in the numeric
// loop. This module answers one question about a claim like "variant rs123 is
// pathogenic for DISEASE": does ClinVar — at a field-standard review-confidence level —
// actually support that clinical interpretation, or does the claim overstate the
// certainty ClinVar records? The verdict is a pure function of what the E-utilities
// API returned; nothing is inferred or fabricated.
//
// Every network call goes through a small INJECTABLE fetcher (VariantDeps) mirroring
// lib/bio/geneticAssociation.ts / lib/ingest/searchAndCache.ts, so the tests run fully
// offline against mocked esearch/esummary responses. On any upstream failure we return
// an honest EMPTY result (no record / not_found) rather than a made-up interpretation —
// a wrong "confident pathogenic" call is worse than an honest "couldn't verify"
// (CLAUDE.md no_support_found principle, applied to variant interpretation).
//
// Data source: NCBI ClinVar via E-utilities. ClinVar aggregate data is in the public
// domain (https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/).

import {
  ClinicalSignificance,
  ClinVarVariantRecord,
  PathogenicityVerdict,
  PathogenicityVerification,
} from "./variant.schemas";

// --- Field-standard star-rating constants --------------------------------------
//
// ClinVar's review status → gold-star rating is a DOCUMENTED, fixed mapping (the
// "Review status" scale at
// https://www.ncbi.nlm.nih.gov/clinvar/docs/review_status/). We reproduce it
// verbatim as a constant; it is NOT tuned. Anything not in this table is 0 stars
// ("no assertion" tiers), which is the honest floor rather than a guessed rating.
export const STAR_BY_REVIEW_STATUS: Readonly<Record<string, number>> = {
  "practice guideline": 4,
  "reviewed by expert panel": 3,
  "criteria provided, multiple submitters, no conflicts": 2,
  "criteria provided, conflicting classifications": 1,
  "criteria provided, conflicting interpretations": 1,
  "criteria provided, single submitter": 1,
  "no assertion criteria provided": 0,
  "no assertion provided": 0,
  "no classification provided": 0,
  "no classification for the individual variant": 0,
};

// Minimum star rating at which we treat a ClinVar interpretation as CONFIDENT enough
// to confirm a strong clinical claim. 1 star = "criteria provided" — the field's
// usual floor for an assertion backed by documented ACMG criteria. Below that
// (0 stars, no assertion criteria) a "pathogenic" label does not, on its own,
// support a confident pathogenicity claim.
export const CONFIDENT_STAR_THRESHOLD = 1;

// --- Field-standard significance normalization ---------------------------------
//
// ClinVar germline classification strings → our ACMG tier vocabulary. Matched
// case-insensitively. Order matters: we test the most specific / strongest phrases
// first so "Likely pathogenic" is not swallowed by the "pathogenic" substring, and a
// combined "Pathogenic/Likely pathogenic" resolves to the stronger tier.
const SIGNIFICANCE_RULES: ReadonlyArray<{
  test: (s: string) => boolean;
  tier: ClinicalSignificance;
}> = [
  { test: (s) => s.includes("conflicting"), tier: "Conflicting" },
  { test: (s) => s.includes("likely pathogenic") && !s.includes("pathogenic/"), tier: "Likely pathogenic" },
  { test: (s) => s.includes("pathogenic"), tier: "Pathogenic" },
  // Symmetric with the pathogenic side: a combined "Benign/Likely benign" resolves to the
  // STRONGER tier ("Benign"), so a benign claim against ClinVar's real "Benign/Likely benign"
  // aggregate is not spuriously downgraded to overstated_certainty.
  { test: (s) => s.includes("likely benign") && !s.includes("benign/"), tier: "Likely benign" },
  { test: (s) => s.includes("benign"), tier: "Benign" },
  {
    test: (s) =>
      s.includes("uncertain significance") ||
      s.includes("uncertain_significance") ||
      s === "vus",
    tier: "VUS",
  },
];

// The tiers a claim of "pathogenic"/"likely pathogenic" asserts. Used both to
// classify the CLAIM and to test whether a ClinVar record supports it.
const PATHOGENIC_TIERS: ReadonlySet<ClinicalSignificance> = new Set([
  "Pathogenic",
  "Likely pathogenic",
]);
const BENIGN_TIERS: ReadonlySet<ClinicalSignificance> = new Set([
  "Benign",
  "Likely benign",
]);

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RECORDS = 50;

// The only side-effecting surface: a fetch-like function. Defaults to global fetch;
// tests inject a stub so no real network call is made. Kept minimal on purpose,
// matching lib/bio/geneticAssociation.ts's FetchLike/GeneticDeps.
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface VariantDeps {
  fetch: FetchLike;
  timeoutMs?: number;
}

const defaultDeps: VariantDeps = {
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

// Run a fetch with a timeout + JSON parse, converting ANY failure (network, non-2xx,
// bad JSON, abort) into `null`. Callers treat null as "this source returned nothing",
// never as an error to surface a fabricated verdict.
async function fetchJsonSafe(
  deps: VariantDeps,
  url: string
): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
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

// --- Deterministic normalization -----------------------------------------------

/**
 * Map a ClinVar review-status string to its 0–4 gold-star rating using the DOCUMENTED
 * field-standard scale (STAR_BY_REVIEW_STATUS). Unknown/absent status → 0 (the honest
 * "no assertion" floor), never a guessed rating.
 */
export function starRatingForReviewStatus(reviewStatus: string | null): number {
  if (!reviewStatus) return 0;
  const key = reviewStatus.trim().toLowerCase();
  const star = STAR_BY_REVIEW_STATUS[key];
  return typeof star === "number" ? star : 0;
}

/**
 * Normalize a raw ClinVar clinical-significance string to our ACMG tier vocabulary,
 * or null when it doesn't map to a known tier (honest unknown, never forced).
 */
export function normalizeSignificance(
  raw: string | null
): ClinicalSignificance | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s.length === 0) return null;
  for (const rule of SIGNIFICANCE_RULES) {
    if (rule.test(s)) return rule.tier;
  }
  return null;
}

// Normalize one esummary result object (values keyed by uid) into a record. The
// esummary "germline_classification"/"clinical_significance" shapes vary across
// ClinVar's schema versions, so we read both defensively — mirroring
// normalizeClinVarRecord in geneticAssociation.ts.
function normalizeRecord(raw: unknown): ClinVarVariantRecord {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const germline = (r.germline_classification &&
  typeof r.germline_classification === "object"
    ? r.germline_classification
    : {}) as Record<string, unknown>;
  const legacy = (r.clinical_significance &&
  typeof r.clinical_significance === "object"
    ? r.clinical_significance
    : {}) as Record<string, unknown>;

  const rawSignificance =
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

  const variant =
    asString(r.title) ?? asString(r.variation_name) ?? asString(r.accession);

  return {
    variant,
    clinicalSignificance: normalizeSignificance(rawSignificance),
    rawSignificance,
    condition,
    reviewStatus,
    starRating: starRatingForReviewStatus(reviewStatus),
  };
}

// The esummary "result" object is keyed by { uids: [...], <uid>: {...} }. Pull the
// per-uid record objects out in uid order — mirrors extractClinVarResults.
function extractResults(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return [];
  const uids = (result as Record<string, unknown>).uids;
  if (!Array.isArray(uids)) return [];
  return uids
    .map((uid) => (result as Record<string, unknown>)[String(uid)])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

// --- ClinVar lookup ------------------------------------------------------------

// Build the ClinVar esearch term from the most specific identifier available. An
// rsID and HGVS expression are specific to a variant; a gene symbol is broader. A
// condition, when present, narrows any of them. Returns null when nothing to search.
function buildTerm(query: {
  rsId?: string;
  hgvs?: string;
  gene?: string;
  condition?: string;
}): string | null {
  const clauses: string[] = [];
  if (query.rsId) clauses.push(`${query.rsId}[Variant name] OR ${query.rsId}`);
  else if (query.hgvs) clauses.push(`"${query.hgvs}"[Variant name]`);
  else if (query.gene) clauses.push(`${query.gene}[gene]`);
  else return null;

  if (query.condition) clauses.push(`${query.condition}[disease]`);
  // AND the (variant OR gene) clause with an optional condition clause.
  return clauses.map((c) => `(${c})`).join(" AND ");
}

export interface VariantLookupQuery {
  rsId?: string;
  hgvs?: string;
  gene?: string;
  condition?: string;
}

/**
 * Query NCBI ClinVar via E-utilities (esearch -> esummary) for interpretations of a
 * variant (rsID / HGVS / gene), optionally narrowed by condition. Returns normalized
 * records — or an empty array on no match / API failure (never a fabricated record).
 * Offline-testable via injected deps.fetch.
 */
export async function lookupVariant(
  query: VariantLookupQuery,
  deps: VariantDeps = defaultDeps
): Promise<ClinVarVariantRecord[]> {
  const term = buildTerm({
    rsId: query.rsId?.trim() || undefined,
    hgvs: query.hgvs?.trim() || undefined,
    gene: query.gene?.trim() || undefined,
    condition: query.condition?.trim() || undefined,
  });
  if (!term) return [];

  const esearchUrl = `${EUTILS_BASE}/esearch.fcgi?db=clinvar&term=${encodeURIComponent(
    term
  )}&retmode=json&retmax=${MAX_RECORDS}`;
  const searchPayload = await fetchJsonSafe(deps, esearchUrl);
  if (searchPayload === null) return [];

  const idlist = (() => {
    const sr = (searchPayload as Record<string, unknown>)?.esearchresult;
    const ids =
      sr && typeof sr === "object"
        ? (sr as Record<string, unknown>).idlist
        : null;
    return Array.isArray(ids)
      ? ids.filter((x): x is string => typeof x === "string")
      : [];
  })();
  if (idlist.length === 0) return [];

  const esummaryUrl = `${EUTILS_BASE}/esummary.fcgi?db=clinvar&id=${encodeURIComponent(
    idlist.slice(0, MAX_RECORDS).join(",")
  )}&retmode=json`;
  const summaryPayload = await fetchJsonSafe(deps, esummaryUrl);
  if (summaryPayload === null) return [];

  return extractResults(summaryPayload).map(normalizeRecord);
}

// --- Deterministic verdict -----------------------------------------------------

// Does a free-text condition query plausibly match a record's condition string?
// Case-insensitive substring either direction (ClinVar conditions are free text).
// When either side is missing we DON'T filter on it — an absent condition query means
// "any condition", and an absent record condition can't be excluded on a fabrication.
function conditionMatches(recordCondition: string | null, query: string | null): boolean {
  if (!query) return true; // no condition constraint → all records eligible
  if (!recordCondition) return false;
  const r = recordCondition.toLowerCase();
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return r.includes(q) || q.includes(r);
}

// Pick the single most authoritative record: highest star rating first, and among
// equal stars prefer a pathogenic tier (the strongest actionable interpretation), so
// `bestRecord` is the one a curator would cite. Deterministic — stable tie-breaks.
function selectBestRecord(
  records: ClinVarVariantRecord[]
): ClinVarVariantRecord | null {
  if (records.length === 0) return null;
  const tierRank = (t: ClinicalSignificance | null): number => {
    if (t === null) return 0;
    if (PATHOGENIC_TIERS.has(t)) return 4;
    if (t === "Conflicting") return 3;
    if (t === "VUS") return 2;
    if (BENIGN_TIERS.has(t)) return 1;
    return 0;
  };
  return records.reduce((best, cur) => {
    if (cur.starRating !== best.starRating) {
      return cur.starRating > best.starRating ? cur : best;
    }
    return tierRank(cur.clinicalSignificance) > tierRank(best.clinicalSignificance)
      ? cur
      : best;
  });
}

/**
 * Verify a pathogenicity CLAIM DETERMINISTICALLY from ClinVar records.
 *
 * Verdict precedence (documented):
 *  1. not_found              — no ClinVar record matched the condition filter.
 *  2. conflicting            — the strongest matched record is ClinVar's own
 *                              "Conflicting classifications" outcome. We surface the
 *                              curator disagreement rather than pick a side.
 *  3. overstated_certainty   — the claim asserts (Likely) Pathogenic, but the
 *                              strongest ClinVar record is VUS/benign, OR is
 *                              pathogenic only at 0 stars (no assertion criteria —
 *                              below CONFIDENT_STAR_THRESHOLD). The claim's certainty
 *                              exceeds what ClinVar supports.
 *  4. confirmed              — the strongest matched record supports the claimed tier
 *                              at >= CONFIDENT_STAR_THRESHOLD stars. With no explicit
 *                              claim, `confirmed` reports the ClinVar consensus for a
 *                              confident pathogenic/benign record.
 *
 * The result carries ONLY the records the API returned; `bestRecord` is the exact
 * highest-star record that drove the verdict, for auditability. No LLM, no randomness.
 */
export function classifyPathogenicity(input: {
  rsId: string | null;
  hgvs: string | null;
  gene: string | null;
  condition: string | null;
  claimedSignificance: string | null;
  records: ClinVarVariantRecord[];
}): PathogenicityVerification {
  const { rsId, hgvs, gene, condition, claimedSignificance, records } = input;

  const query = { rsId, hgvs, gene, condition, claimedSignificance };
  const matched = records.filter((r) => conditionMatches(r.condition, condition));
  const best = selectBestRecord(matched);

  const base = { query, records: matched };

  // 1. Honest empty.
  if (!best) {
    return {
      verdict: "not_found",
      ...base,
      bestRecord: null,
      rationale: condition
        ? `ClinVar returned no record for this variant matching condition "${condition}".`
        : "ClinVar returned no record for this variant.",
    };
  }

  // Normalized claim tier (what the claim asserts), if any.
  const claimTier = normalizeSignificance(claimedSignificance);
  const claimIsPathogenic = claimTier !== null && PATHOGENIC_TIERS.has(claimTier);

  const bestTier = best.clinicalSignificance;
  const confident = best.starRating >= CONFIDENT_STAR_THRESHOLD;

  // 2. ClinVar itself reports conflicting classifications.
  if (bestTier === "Conflicting") {
    return {
      verdict: "conflicting",
      ...base,
      bestRecord: best,
      rationale: `ClinVar reports conflicting classifications of pathogenicity for this variant (review status "${best.reviewStatus ?? "unknown"}", ${best.starRating}★).`,
    };
  }

  // 3/4. Claim-specific check for a pathogenicity assertion.
  if (claimIsPathogenic) {
    const clinvarSupportsPathogenic =
      bestTier !== null && PATHOGENIC_TIERS.has(bestTier);

    if (clinvarSupportsPathogenic && confident) {
      return {
        verdict: "confirmed",
        ...base,
        bestRecord: best,
        rationale: `ClinVar classifies this variant as ${bestTier} at ${best.starRating}★ ("${best.reviewStatus ?? "unknown"}"), supporting the claimed ${claimTier}.`,
      };
    }

    // Overstated: ClinVar is VUS/benign, unmapped, OR pathogenic but below the
    // confident star threshold (e.g. a 1-star claim resting on a 0-star assertion).
    const clinvarSays =
      bestTier === null
        ? `an unclassified record`
        : `${bestTier}${confident ? "" : ` at only ${best.starRating}★`}`;
    return {
      verdict: "overstated_certainty",
      ...base,
      bestRecord: best,
      rationale: `Claim asserts ${claimTier}, but the strongest ClinVar record is ${clinvarSays} (review status "${best.reviewStatus ?? "unknown"}", ${best.starRating}★) — the claim overstates the certainty ClinVar supports.`,
    };
  }

  // No explicit pathogenic claim (or a benign/VUS claim): report the ClinVar
  // consensus. A confident record is `confirmed` (this IS what ClinVar says); an
  // unconfident/unmapped one is honestly `overstated_certainty` only when a claim was
  // made and unmet — otherwise `confirmed` simply reflects the record as-is.
  if (claimTier !== null) {
    const agrees = bestTier === claimTier;
    if (agrees && confident) {
      return {
        verdict: "confirmed",
        ...base,
        bestRecord: best,
        rationale: `ClinVar classifies this variant as ${bestTier} at ${best.starRating}★, matching the claimed ${claimTier}.`,
      };
    }
    return {
      verdict: "overstated_certainty",
      ...base,
      bestRecord: best,
      rationale: `Claim asserts ${claimTier}, but ClinVar's strongest record is ${bestTier ?? "unclassified"} at ${best.starRating}★ ("${best.reviewStatus ?? "unknown"}").`,
    };
  }

  // No claim supplied: surface the consensus. Confident → confirmed (report), else
  // still confirmed-as-reported but the star rating carries the caveat.
  return {
    verdict: "confirmed",
    ...base,
    bestRecord: best,
    rationale: `ClinVar's strongest record classifies this variant as ${bestTier ?? "unclassified"} at ${best.starRating}★ ("${best.reviewStatus ?? "unknown"}").`,
  };
}

/**
 * End-to-end pathogenicity verification: look ClinVar up for the given variant, then
 * classify the returned records deterministically against the claim. A failing lookup
 * degrades to an empty record list (honest not_found) rather than throwing — mirroring
 * the searchAndCache / verifyGeneticAssociation resilience pattern.
 */
export async function verifyPathogenicityClaim(
  request: {
    rsId?: string;
    hgvs?: string;
    gene?: string;
    condition?: string;
    claimedSignificance?: string;
  },
  deps: VariantDeps = defaultDeps
): Promise<PathogenicityVerification> {
  const rsId = request.rsId?.trim() || null;
  const hgvs = request.hgvs?.trim() || null;
  const gene = request.gene?.trim() || null;
  const condition = request.condition?.trim() || null;
  const claimedSignificance = request.claimedSignificance?.trim() || null;

  const records = await lookupVariant(
    {
      rsId: rsId ?? undefined,
      hgvs: hgvs ?? undefined,
      gene: gene ?? undefined,
      condition: condition ?? undefined,
    },
    deps
  ).catch(() => [] as ClinVarVariantRecord[]);

  return classifyPathogenicity({
    rsId,
    hgvs,
    gene,
    condition,
    claimedSignificance,
    records,
  });
}

import type { Pool } from "pg";
import { getPool } from "@/lib/db";

// Analytics read layer. Every query is org-scoped. The legacy `verifications`
// table has no org_id — it links to a claim via claim_id, and claims carry the
// org — so verification analytics join through claims and filter on the claim's
// org (never on client input directly). All SQL is parameterized.
//
// This module lives beside the analytics routes (it is not itself a route) so the
// module owns its own data access without reaching into sibling lib/ directories.

// The full discrepancy vocabulary, in a stable display order. `accurate` means the
// claim matched its source; every other outcome is a distortion of some kind.
export const DISCREPANCY_TYPES = [
  "accurate",
  "magnitude_overstated",
  "population_overgeneralized",
  "caveat_dropped",
  "no_support_found",
] as const;

export type DiscrepancyType = (typeof DISCREPANCY_TYPES)[number];

// Registry verdicts produced by the deterministic ClinicalTrials.gov check. Kept
// in sync with lib/structuredVerification.ts's RegistryVerdict union.
export const REGISTRY_VERDICTS = [
  "matches_registry",
  "overstates_registry",
  "understates_registry",
  "significance_mismatch",
  "secondary_endpoint_match",
  "no_registered_results",
  "not_comparable",
] as const;

export type RegistryVerdict = (typeof REGISTRY_VERDICTS)[number];

function isDistortion(type: string | null): boolean {
  return type !== null && type !== "accurate";
}

// ---------------------------------------------------------------------------
// Overview KPIs
// ---------------------------------------------------------------------------

export interface DiscrepancyBreakdownItem {
  type: string;
  count: number;
  /** Share of all verifications with this discrepancy type (0–1). */
  rate: number;
}

export interface OverviewMetrics {
  claimsVerified: number;
  totalVerifications: number;
  documentsProcessed: number;
  avgTrustScore: number | null;
  distortionRate: number;
  distortionByType: DiscrepancyBreakdownItem[];
}

interface CountRow {
  c: number;
}
interface AvgRow {
  avg: string | null;
}
interface DiscrepancyRow {
  discrepancy_type: string | null;
  c: number;
}

export async function getOverviewMetrics(
  orgId: string,
  pool: Pool = getPool()
): Promise<OverviewMetrics> {
  const [
    claimsVerifiedRes,
    verificationsRes,
    documentsRes,
    avgTrustRes,
    byTypeRes,
  ] = await Promise.all([
    // Distinct claims that have at least one verification in this org.
    pool.query<CountRow>(
      `select count(distinct c.id)::int as c
         from claims c
         join verifications v on v.claim_id = c.id
        where c.org_id = $1`,
      [orgId]
    ),
    pool.query<CountRow>(
      `select count(v.*)::int as c
         from verifications v
         join claims c on c.id = v.claim_id
        where c.org_id = $1`,
      [orgId]
    ),
    pool.query<CountRow>(
      `select count(*)::int as c from documents where org_id = $1`,
      [orgId]
    ),
    pool.query<AvgRow>(
      `select avg(v.trust_score) as avg
         from verifications v
         join claims c on c.id = v.claim_id
        where c.org_id = $1`,
      [orgId]
    ),
    pool.query<DiscrepancyRow>(
      `select coalesce(v.discrepancy_type, 'no_support_found') as discrepancy_type,
              count(v.*)::int as c
         from verifications v
         join claims c on c.id = v.claim_id
        where c.org_id = $1
        group by v.discrepancy_type`,
      [orgId]
    ),
  ]);

  const total = verificationsRes.rows[0]?.c ?? 0;

  // Build a stable, zero-filled breakdown over the full vocabulary.
  const counts = new Map<string, number>();
  for (const row of byTypeRes.rows) {
    const key = row.discrepancy_type ?? "no_support_found";
    counts.set(key, (counts.get(key) ?? 0) + row.c);
  }
  const distortionByType: DiscrepancyBreakdownItem[] = DISCREPANCY_TYPES.map(
    (type) => {
      const count = counts.get(type) ?? 0;
      return { type, count, rate: total > 0 ? count / total : 0 };
    }
  );

  const distortions = distortionByType
    .filter((d) => isDistortion(d.type))
    .reduce((sum, d) => sum + d.count, 0);

  const avgRaw = avgTrustRes.rows[0]?.avg;
  const avgTrustScore =
    avgRaw === null || avgRaw === undefined ? null : Math.round(Number(avgRaw));

  return {
    claimsVerified: claimsVerifiedRes.rows[0]?.c ?? 0,
    totalVerifications: total,
    documentsProcessed: documentsRes.rows[0]?.c ?? 0,
    avgTrustScore,
    distortionRate: total > 0 ? distortions / total : 0,
    distortionByType,
  };
}

// ---------------------------------------------------------------------------
// Verification time series + breakdowns
// ---------------------------------------------------------------------------

export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD (UTC day bucket)
  total: number;
  distortions: number;
  avgTrustScore: number | null;
}

export interface TrustBucket {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface VerificationAnalytics {
  rangeDays: number;
  totalInRange: number;
  series: TimeSeriesPoint[];
  byType: DiscrepancyBreakdownItem[];
  trustDistribution: TrustBucket[];
}

interface SeriesRow {
  day: Date;
  total: number;
  distortions: number;
  avg_trust: string | null;
}

// Clamp the window so a caller can't request an unbounded scan.
const MIN_RANGE_DAYS = 1;
const MAX_RANGE_DAYS = 365;

export function clampRangeDays(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return 30;
  const floored = Math.floor(raw);
  return Math.min(Math.max(floored, MIN_RANGE_DAYS), MAX_RANGE_DAYS);
}

const TRUST_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "0–20", min: 0, max: 20 },
  { label: "21–40", min: 21, max: 40 },
  { label: "41–60", min: 41, max: 60 },
  { label: "61–80", min: 61, max: 80 },
  { label: "81–100", min: 81, max: 100 },
];

export async function getVerificationAnalytics(
  orgId: string,
  rangeDays: number,
  pool: Pool = getPool()
): Promise<VerificationAnalytics> {
  const [seriesRes, byTypeRes, trustRes] = await Promise.all([
    pool.query<SeriesRow>(
      `select
          date_trunc('day', v.created_at) as day,
          count(v.*)::int as total,
          count(v.*) filter (
            where v.discrepancy_type is distinct from 'accurate'
          )::int as distortions,
          avg(v.trust_score) as avg_trust
         from verifications v
         join claims c on c.id = v.claim_id
        where c.org_id = $1
          and v.created_at >= now() - ($2::int || ' days')::interval
        group by 1
        order by 1 asc`,
      [orgId, rangeDays]
    ),
    pool.query<DiscrepancyRow>(
      `select coalesce(v.discrepancy_type, 'no_support_found') as discrepancy_type,
              count(v.*)::int as c
         from verifications v
         join claims c on c.id = v.claim_id
        where c.org_id = $1
          and v.created_at >= now() - ($2::int || ' days')::interval
        group by v.discrepancy_type`,
      [orgId, rangeDays]
    ),
    pool.query<{ trust_score: number | null; c: number }>(
      `select v.trust_score, count(v.*)::int as c
         from verifications v
         join claims c on c.id = v.claim_id
        where c.org_id = $1
          and v.created_at >= now() - ($2::int || ' days')::interval
          and v.trust_score is not null
        group by v.trust_score`,
      [orgId, rangeDays]
    ),
  ]);

  const series: TimeSeriesPoint[] = seriesRes.rows.map((r) => ({
    date: toIsoDay(r.day),
    total: r.total,
    distortions: r.distortions,
    avgTrustScore:
      r.avg_trust === null ? null : Math.round(Number(r.avg_trust)),
  }));

  const totalInRange = series.reduce((sum, p) => sum + p.total, 0);

  const counts = new Map<string, number>();
  for (const row of byTypeRes.rows) {
    const key = row.discrepancy_type ?? "no_support_found";
    counts.set(key, (counts.get(key) ?? 0) + row.c);
  }
  const byType: DiscrepancyBreakdownItem[] = DISCREPANCY_TYPES.map((type) => {
    const count = counts.get(type) ?? 0;
    return { type, count, rate: totalInRange > 0 ? count / totalInRange : 0 };
  });

  const trustDistribution: TrustBucket[] = TRUST_BUCKETS.map((b) => {
    let count = 0;
    for (const row of trustRes.rows) {
      const score = row.trust_score;
      if (score !== null && score >= b.min && score <= b.max) count += row.c;
    }
    return { label: b.label, min: b.min, max: b.max, count };
  });

  return { rangeDays, totalInRange, series, byType, trustDistribution };
}

function toIsoDay(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Registry-check outcome distribution
// ---------------------------------------------------------------------------
//
// The deterministic registry verdict is computed at verify time and not persisted
// on the verification row. What IS available per verification is the matched
// source and whether that source has registered results. We approximate the
// registry-check outcome distribution from durable, org-scoped signals:
//   - verifications whose matched source is a ClinicalTrials.gov record WITH
//     posted results are "registry-checkable";
//   - among those, we bucket by the verification's discrepancy_type, which is the
//     stored outcome of the comparison, plus surface how many sources carry
//     registered results at all (registry coverage).
// This keeps the endpoint honest: it reports what the data supports rather than
// fabricating a verdict that was never stored.

export interface RegistryOutcomeItem {
  outcome: string;
  count: number;
  rate: number;
}

export interface RegistryAnalytics {
  /** Verifications matched to a ClinicalTrials.gov source. */
  trialMatchedVerifications: number;
  /** Of those, how many matched a source that has posted registered results. */
  registryCheckable: number;
  /** Distinct cached ClinicalTrials.gov sources that carry registered results. */
  sourcesWithRegisteredResults: number;
  /** Distinct cached ClinicalTrials.gov sources matched by this org. */
  trialSourcesMatched: number;
  /** Discrepancy-type distribution among registry-checkable verifications. */
  outcomeDistribution: RegistryOutcomeItem[];
}

export async function getRegistryAnalytics(
  orgId: string,
  pool: Pool = getPool()
): Promise<RegistryAnalytics> {
  const [trialMatchedRes, checkableRes, distRes, sourceRes] = await Promise.all([
    pool.query<CountRow>(
      `select count(v.*)::int as c
         from verifications v
         join claims c on c.id = v.claim_id
         join sources s on s.id = v.matched_source_id
        where c.org_id = $1
          and s.source_type = 'clinicaltrials'`,
      [orgId]
    ),
    pool.query<CountRow>(
      `select count(v.*)::int as c
         from verifications v
         join claims c on c.id = v.claim_id
         join sources s on s.id = v.matched_source_id
        where c.org_id = $1
          and s.source_type = 'clinicaltrials'
          and s.registered_results is not null
          and jsonb_array_length(coalesce(s.registered_results, '[]'::jsonb)) > 0`,
      [orgId]
    ),
    pool.query<DiscrepancyRow>(
      `select coalesce(v.discrepancy_type, 'no_support_found') as discrepancy_type,
              count(v.*)::int as c
         from verifications v
         join claims c on c.id = v.claim_id
         join sources s on s.id = v.matched_source_id
        where c.org_id = $1
          and s.source_type = 'clinicaltrials'
          and s.registered_results is not null
          and jsonb_array_length(coalesce(s.registered_results, '[]'::jsonb)) > 0
        group by v.discrepancy_type`,
      [orgId]
    ),
    pool.query<{ with_results: number; total: number }>(
      `select
          count(distinct s.id) filter (
            where s.registered_results is not null
              and jsonb_array_length(coalesce(s.registered_results, '[]'::jsonb)) > 0
          )::int as with_results,
          count(distinct s.id)::int as total
         from verifications v
         join claims c on c.id = v.claim_id
         join sources s on s.id = v.matched_source_id
        where c.org_id = $1
          and s.source_type = 'clinicaltrials'`,
      [orgId]
    ),
  ]);

  const registryCheckable = checkableRes.rows[0]?.c ?? 0;

  const counts = new Map<string, number>();
  for (const row of distRes.rows) {
    const key = row.discrepancy_type ?? "no_support_found";
    counts.set(key, (counts.get(key) ?? 0) + row.c);
  }
  const outcomeDistribution: RegistryOutcomeItem[] = DISCREPANCY_TYPES.map(
    (type) => {
      const count = counts.get(type) ?? 0;
      return {
        outcome: type,
        count,
        rate: registryCheckable > 0 ? count / registryCheckable : 0,
      };
    }
  );

  return {
    trialMatchedVerifications: trialMatchedRes.rows[0]?.c ?? 0,
    registryCheckable,
    sourcesWithRegisteredResults: sourceRes.rows[0]?.with_results ?? 0,
    trialSourcesMatched: sourceRes.rows[0]?.total ?? 0,
    outcomeDistribution,
  };
}

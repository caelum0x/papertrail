import type { Pool } from "pg";
import type { ValidationStatusLevel } from "@/lib/validation/status.schemas";

// VALIDATION / COMPLIANCE STATUS logic. Two concerns, cleanly separated:
//
//   * computeValidationStatus — PURE + deterministic. Given which engines ran,
//     which were required, and which sources were reachable, it derives coverage,
//     a documented quality score, and a status level. No I/O, no mutation.
//   * recordValidationRun — the only DB boundary. Persists a computed status
//     org-scoped (org_id is always the first column written and read).
//
// Keeping the math pure means the same inputs always yield the same validation
// report — the property a regulated buyer needs to trust the artifact — and it is
// exhaustively unit-testable without a database.

export interface ComputeValidationInput {
  enginesRun: readonly string[];
  requiredEngines: readonly string[];
  sourcesReachable: Readonly<Record<string, boolean>>;
}

export interface ValidationStatus {
  coverage: number; // ran-of-required, in [0,1]
  sourceReachability: number; // reachable-of-known, in [0,1]
  qualityScore: number; // documented weighting, in [0,1]
  status: ValidationStatusLevel;
  ranRequiredCount: number;
  requiredCount: number;
  reachableSourceCount: number;
  knownSourceCount: number;
}

// Documented quality weighting. The score is a convex combination of two signals,
// each a fraction in [0,1], so the result is itself in [0,1]:
//
//   qualityScore = COVERAGE_WEIGHT * coverage
//                + SOURCE_WEIGHT   * sourceReachability
//
// Coverage dominates (0.7): a run that skipped required engines is fundamentally
// less validated than one that merely hit an unreachable source. Source
// reachability (0.3) still matters because an engine that ran against an
// unreachable primary source produced a weaker result. These weights are
// intentionally fixed constants — determinism over tunability — and sum to 1.
export const COVERAGE_WEIGHT = 0.7;
export const SOURCE_WEIGHT = 0.3;

// Status thresholds over the quality score, checked high-to-low. Documented and
// fixed so the label is a pure function of the inputs.
export const COMPLETE_THRESHOLD = 1; // every required engine ran and every source reachable
export const PARTIAL_THRESHOLD = 0.5; // meaningful-but-incomplete coverage

// Round to 4 decimals so persisted numerics and equality checks are stable and
// free of floating-point dust, without losing meaningful precision.
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// Fraction of `required` that appears in `ran`. If nothing is required, coverage
// is defined as 1 (vacuously complete) rather than 0 — a run with no requirements
// cannot have "missed" anything.
function computeCoverage(
  ran: readonly string[],
  required: readonly string[]
): { coverage: number; ranRequiredCount: number; requiredCount: number } {
  const requiredSet = Array.from(new Set(required));
  const ranSet = new Set(ran);
  if (requiredSet.length === 0) {
    return { coverage: 1, ranRequiredCount: 0, requiredCount: 0 };
  }
  const ranRequiredCount = requiredSet.filter((e) => ranSet.has(e)).length;
  return {
    coverage: ranRequiredCount / requiredSet.length,
    ranRequiredCount,
    requiredCount: requiredSet.length,
  };
}

// Fraction of known sources that were reachable. With no known sources, defined
// as 1 (nothing was expected, so nothing is missing).
function computeSourceReachability(
  sources: Readonly<Record<string, boolean>>
): { reachability: number; reachableCount: number; knownCount: number } {
  const values = Object.values(sources);
  if (values.length === 0) {
    return { reachability: 1, reachableCount: 0, knownCount: 0 };
  }
  const reachableCount = values.filter((v) => v === true).length;
  return {
    reachability: reachableCount / values.length,
    reachableCount,
    knownCount: values.length,
  };
}

function deriveStatus(
  coverage: number,
  qualityScore: number
): ValidationStatusLevel {
  // Complete requires FULL required-engine coverage AND a perfect quality score
  // (which, given the weighting, also implies every known source was reachable).
  if (coverage >= COMPLETE_THRESHOLD && qualityScore >= COMPLETE_THRESHOLD) {
    return "complete";
  }
  if (qualityScore >= PARTIAL_THRESHOLD) {
    return "partial";
  }
  return "insufficient";
}

// PURE + deterministic: same inputs -> same validation report, always.
export function computeValidationStatus(
  input: ComputeValidationInput
): ValidationStatus {
  const { coverage, ranRequiredCount, requiredCount } = computeCoverage(
    input.enginesRun,
    input.requiredEngines
  );
  const { reachability, reachableCount, knownCount } =
    computeSourceReachability(input.sourcesReachable);

  const qualityScore =
    COVERAGE_WEIGHT * coverage + SOURCE_WEIGHT * reachability;

  const status = deriveStatus(coverage, qualityScore);

  return {
    coverage: round4(coverage),
    sourceReachability: round4(reachability),
    qualityScore: round4(qualityScore),
    status,
    ranRequiredCount,
    requiredCount,
    reachableSourceCount: reachableCount,
    knownSourceCount: knownCount,
  };
}

export interface ValidationRunRecord {
  id: string;
  orgId: string;
  subject: string;
  enginesRun: string[];
  sourcesReachable: Record<string, boolean>;
  coverage: number;
  qualityScore: number;
  status: ValidationStatusLevel;
  createdAt: string;
}

interface ValidationRunRow {
  id: string;
  org_id: string;
  subject: string;
  engines_run: unknown;
  sources_reachable: unknown;
  coverage: string | number;
  quality_score: string | number;
  status: string;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// jsonb columns come back as already-parsed JS values from node-postgres, but be
// defensive: coerce to the expected shape, never trust the driver's typing.
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asBoolRecord(value: unknown): Record<string, boolean> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

function mapRow(row: ValidationRunRow): ValidationRunRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    subject: row.subject,
    enginesRun: asStringArray(row.engines_run),
    sourcesReachable: asBoolRecord(row.sources_reachable),
    coverage: Number(row.coverage),
    qualityScore: Number(row.quality_score),
    status: row.status as ValidationStatusLevel,
    createdAt: toIso(row.created_at),
  };
}

const RUN_SELECT = `
  select id, org_id, subject, engines_run, sources_reachable,
         coverage, quality_score, status, created_at
    from validation_runs
`;

export interface RecordValidationRunParams {
  subject: string;
  enginesRun: readonly string[];
  sourcesReachable: Readonly<Record<string, boolean>>;
  status: ValidationStatus;
}

// Persists a computed validation run, org-scoped. org_id is the first column
// written and is taken from the caller's resolved context — never from client
// input. The computed status is the source of truth for coverage/quality/status;
// this function does not re-derive them, keeping the pure logic authoritative.
export async function recordValidationRun(
  pool: Pool,
  orgId: string,
  subject: string,
  status: ValidationStatus,
  enginesRun: readonly string[] = [],
  sourcesReachable: Readonly<Record<string, boolean>> = {}
): Promise<ValidationRunRecord> {
  const { rows } = await pool.query<ValidationRunRow>(
    `insert into validation_runs
       (org_id, subject, engines_run, sources_reachable, coverage, quality_score, status)
     values ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
     returning id, org_id, subject, engines_run, sources_reachable,
               coverage, quality_score, status, created_at`,
    [
      orgId,
      subject,
      JSON.stringify(Array.from(new Set(enginesRun))),
      JSON.stringify(sourcesReachable),
      status.coverage,
      status.qualityScore,
      status.status,
    ]
  );
  return mapRow(rows[0]);
}

// Lists the org's validation runs, newest first. org_id is always the first
// predicate so a caller can never read another tenant's runs.
export async function listValidationRuns(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<{ items: ValidationRunRecord[]; total: number }> {
  const countRes = await pool.query<{ total: number }>(
    `select count(*)::int as total from validation_runs where org_id = $1`,
    [orgId]
  );
  const total = countRes.rows[0]?.total ?? 0;

  const { rows } = await pool.query<ValidationRunRow>(
    `${RUN_SELECT}
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return { items: rows.map(mapRow), total };
}

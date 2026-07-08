import type { Pool } from "pg";
import type {
  EvalCase,
  EvalRun,
  EvalRunStatus,
  EvalRunSummary,
  EvalSet,
  PredictedResult,
} from "@/lib/eval/types";
import type { DiscrepancyType } from "@/lib/eval/schemas";

// Org-scoped data access for the agent-eval module. Every query filters by
// org_id so no query can read or write another org's eval data. All rows are
// mapped from snake_case DB columns to the camelCased domain types.

// Normalize a timestamptz column (returned as Date or string by node-postgres)
// to an ISO string for the API/UI layer.
function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

interface EvalSetRow {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_at: Date | string;
  case_count?: string | number;
  run_count?: string | number;
  last_accuracy?: number | null;
}

function mapSet(row: EvalSetRow): EvalSet {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    createdAt: toIso(row.created_at),
    caseCount: row.case_count !== undefined ? Number(row.case_count) : undefined,
    runCount: row.run_count !== undefined ? Number(row.run_count) : undefined,
    lastAccuracy: row.last_accuracy ?? null,
  };
}

interface EvalCaseRow {
  id: string;
  org_id: string;
  eval_set_id: string;
  claim: string;
  source_external_id: string | null;
  expected_discrepancy_type: string;
  expected_substrings: unknown;
  created_at: Date | string;
}

function mapCase(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    orgId: row.org_id,
    evalSetId: row.eval_set_id,
    claim: row.claim,
    sourceExternalId: row.source_external_id,
    expectedDiscrepancyType: row.expected_discrepancy_type as DiscrepancyType,
    expectedSubstrings: Array.isArray(row.expected_substrings)
      ? (row.expected_substrings as string[])
      : [],
    createdAt: toIso(row.created_at),
  };
}

interface EvalRunRow {
  id: string;
  org_id: string;
  eval_set_id: string;
  status: string;
  accuracy: number | null;
  span_grounding_rate: number | null;
  summary: unknown;
  created_at: Date | string;
}

function mapRun(row: EvalRunRow): EvalRun {
  return {
    id: row.id,
    orgId: row.org_id,
    evalSetId: row.eval_set_id,
    status: row.status as EvalRunStatus,
    accuracy: row.accuracy ?? null,
    spanGroundingRate: row.span_grounding_rate ?? null,
    summary: (row.summary ?? {}) as EvalRunSummary,
    createdAt: toIso(row.created_at),
  };
}

// ---- eval_sets ----

export async function listEvalSets(
  pool: Pool,
  params: { orgId: string; limit: number; offset: number }
): Promise<{ items: EvalSet[]; total: number }> {
  const { rows } = await pool.query(
    `select s.id, s.org_id, s.name, s.description, s.created_at,
            (select count(*) from eval_cases c where c.eval_set_id = s.id) as case_count,
            (select count(*) from eval_runs r where r.eval_set_id = s.id) as run_count,
            (select r.accuracy from eval_runs r
              where r.eval_set_id = s.id and r.status = 'completed'
              order by r.created_at desc limit 1) as last_accuracy
       from eval_sets s
      where s.org_id = $1
      order by s.created_at desc
      limit $2 offset $3`,
    [params.orgId, params.limit, params.offset]
  );
  const { rows: countRows } = await pool.query(
    `select count(*)::int as total from eval_sets where org_id = $1`,
    [params.orgId]
  );
  return {
    items: (rows as EvalSetRow[]).map(mapSet),
    total: countRows[0]?.total ?? 0,
  };
}

export async function getEvalSet(
  pool: Pool,
  orgId: string,
  id: string
): Promise<EvalSet | null> {
  const { rows } = await pool.query(
    `select s.id, s.org_id, s.name, s.description, s.created_at,
            (select count(*) from eval_cases c where c.eval_set_id = s.id) as case_count,
            (select count(*) from eval_runs r where r.eval_set_id = s.id) as run_count,
            (select r.accuracy from eval_runs r
              where r.eval_set_id = s.id and r.status = 'completed'
              order by r.created_at desc limit 1) as last_accuracy
       from eval_sets s
      where s.org_id = $1 and s.id = $2`,
    [orgId, id]
  );
  return rows.length > 0 ? mapSet(rows[0] as EvalSetRow) : null;
}

export async function createEvalSet(
  pool: Pool,
  params: { orgId: string; name: string; description: string | null }
): Promise<EvalSet> {
  const { rows } = await pool.query(
    `insert into eval_sets (org_id, name, description)
     values ($1, $2, $3)
     returning id, org_id, name, description, created_at`,
    [params.orgId, params.name, params.description]
  );
  return mapSet(rows[0] as EvalSetRow);
}

// ---- eval_cases ----

export async function listEvalCases(
  pool: Pool,
  params: { orgId: string; evalSetId: string; limit: number; offset: number }
): Promise<{ items: EvalCase[]; total: number }> {
  const { rows } = await pool.query(
    `select id, org_id, eval_set_id, claim, source_external_id,
            expected_discrepancy_type, expected_substrings, created_at
       from eval_cases
      where org_id = $1 and eval_set_id = $2
      order by created_at asc
      limit $3 offset $4`,
    [params.orgId, params.evalSetId, params.limit, params.offset]
  );
  const { rows: countRows } = await pool.query(
    `select count(*)::int as total from eval_cases where org_id = $1 and eval_set_id = $2`,
    [params.orgId, params.evalSetId]
  );
  return {
    items: (rows as EvalCaseRow[]).map(mapCase),
    total: countRows[0]?.total ?? 0,
  };
}

// All cases in a set (unpaginated) — used by the runner.
export async function getAllEvalCases(
  pool: Pool,
  orgId: string,
  evalSetId: string
): Promise<EvalCase[]> {
  const { rows } = await pool.query(
    `select id, org_id, eval_set_id, claim, source_external_id,
            expected_discrepancy_type, expected_substrings, created_at
       from eval_cases
      where org_id = $1 and eval_set_id = $2
      order by created_at asc`,
    [orgId, evalSetId]
  );
  return (rows as EvalCaseRow[]).map(mapCase);
}

export async function createEvalCase(
  pool: Pool,
  params: {
    orgId: string;
    evalSetId: string;
    claim: string;
    sourceExternalId: string | null;
    expectedDiscrepancyType: DiscrepancyType;
    expectedSubstrings: string[];
  }
): Promise<EvalCase> {
  const { rows } = await pool.query(
    `insert into eval_cases
       (org_id, eval_set_id, claim, source_external_id, expected_discrepancy_type, expected_substrings)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning id, org_id, eval_set_id, claim, source_external_id,
               expected_discrepancy_type, expected_substrings, created_at`,
    [
      params.orgId,
      params.evalSetId,
      params.claim,
      params.sourceExternalId,
      params.expectedDiscrepancyType,
      JSON.stringify(params.expectedSubstrings),
    ]
  );
  return mapCase(rows[0] as EvalCaseRow);
}

// ---- eval_runs ----

export async function listEvalRuns(
  pool: Pool,
  params: { orgId: string; evalSetId?: string; limit: number; offset: number }
): Promise<{ items: EvalRun[]; total: number }> {
  const filters: unknown[] = [params.orgId];
  let where = "org_id = $1";
  if (params.evalSetId) {
    where += " and eval_set_id = $2";
    filters.push(params.evalSetId);
  }
  const { rows } = await pool.query(
    `select id, org_id, eval_set_id, status, accuracy, span_grounding_rate, summary, created_at
       from eval_runs
      where ${where}
      order by created_at desc
      limit $${filters.length + 1} offset $${filters.length + 2}`,
    [...filters, params.limit, params.offset]
  );
  const { rows: countRows } = await pool.query(
    `select count(*)::int as total from eval_runs where ${where}`,
    filters
  );
  return {
    items: (rows as EvalRunRow[]).map(mapRun),
    total: countRows[0]?.total ?? 0,
  };
}

export async function getEvalRun(
  pool: Pool,
  orgId: string,
  id: string
): Promise<EvalRun | null> {
  const { rows } = await pool.query(
    `select id, org_id, eval_set_id, status, accuracy, span_grounding_rate, summary, created_at
       from eval_runs
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows.length > 0 ? mapRun(rows[0] as EvalRunRow) : null;
}

export async function createEvalRun(
  pool: Pool,
  params: { orgId: string; evalSetId: string }
): Promise<EvalRun> {
  const { rows } = await pool.query(
    `insert into eval_runs (org_id, eval_set_id, status)
     values ($1, $2, 'running')
     returning id, org_id, eval_set_id, status, accuracy, span_grounding_rate, summary, created_at`,
    [params.orgId, params.evalSetId]
  );
  return mapRun(rows[0] as EvalRunRow);
}

export async function finalizeEvalRun(
  pool: Pool,
  params: {
    orgId: string;
    runId: string;
    status: EvalRunStatus;
    accuracy: number | null;
    spanGroundingRate: number | null;
    summary: EvalRunSummary;
  }
): Promise<EvalRun | null> {
  const { rows } = await pool.query(
    `update eval_runs
        set status = $3, accuracy = $4, span_grounding_rate = $5, summary = $6::jsonb
      where org_id = $1 and id = $2
      returning id, org_id, eval_set_id, status, accuracy, span_grounding_rate, summary, created_at`,
    [
      params.orgId,
      params.runId,
      params.status,
      params.accuracy,
      params.spanGroundingRate,
      JSON.stringify(params.summary),
    ]
  );
  return rows.length > 0 ? mapRun(rows[0] as EvalRunRow) : null;
}

// ---- eval_results ----

export interface EvalResultRecord {
  id: string;
  caseId: string;
  predicted: PredictedResult & { score?: unknown };
  passed: boolean;
  createdAt: string;
  case?: EvalCase | null;
}

export async function insertEvalResult(
  pool: Pool,
  params: {
    orgId: string;
    runId: string;
    caseId: string;
    predicted: unknown;
    passed: boolean;
  }
): Promise<void> {
  await pool.query(
    `insert into eval_results (org_id, eval_run_id, case_id, predicted, passed)
     values ($1, $2, $3, $4::jsonb, $5)`,
    [
      params.orgId,
      params.runId,
      params.caseId,
      JSON.stringify(params.predicted ?? {}),
      params.passed,
    ]
  );
}

// Per-case results for a run, joined to the originating case so the UI can show
// expected-vs-predicted side by side.
export async function getEvalResults(
  pool: Pool,
  orgId: string,
  runId: string
): Promise<EvalResultRecord[]> {
  const { rows } = await pool.query(
    `select r.id, r.case_id, r.predicted, r.passed, r.created_at,
            c.claim, c.source_external_id, c.expected_discrepancy_type,
            c.expected_substrings, c.eval_set_id, c.org_id as case_org_id,
            c.created_at as case_created_at
       from eval_results r
       join eval_cases c on c.id = r.case_id
      where r.org_id = $1 and r.eval_run_id = $2
      order by r.created_at asc`,
    [orgId, runId]
  );
  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    predicted: (row.predicted ?? {}) as PredictedResult & { score?: unknown },
    passed: row.passed,
    createdAt: toIso(row.created_at),
    case: mapCase({
      id: row.case_id,
      org_id: row.case_org_id,
      eval_set_id: row.eval_set_id,
      claim: row.claim,
      source_external_id: row.source_external_id,
      expected_discrepancy_type: row.expected_discrepancy_type,
      expected_substrings: row.expected_substrings,
      created_at: row.case_created_at,
    }),
  }));
}

// Data access for the agentic workflow engine. All queries are org-scoped (filter
// by org_id) and parameterized. The runner and API routes depend on these; storage
// details (Postgres) stay behind this repository boundary.

import type { Pool } from "pg";
import type { WorkflowDefinition, WorkflowRunStatus } from "./types";

export interface CustomWorkflow {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  definition: WorkflowDefinition;
  createdBy: string | null;
  createdAt: string;
}

export interface RunSummary {
  id: string;
  orgId: string;
  workflowId: string | null;
  workflowKey: string | null;
  status: WorkflowRunStatus;
  error: string | null;
  createdBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface RunDetail extends RunSummary {
  input: unknown;
  output: unknown;
  steps: StepRow[];
}

export interface StepRow {
  id: string;
  stepIndex: number;
  name: string;
  status: string;
  input: unknown;
  output: unknown;
  error: string | null;
  tokens: number | null;
  durationMs: number | null;
  createdAt: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ── Custom workflows ─────────────────────────────────────────────────────────

export async function listCustomWorkflows(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<{ items: CustomWorkflow[]; total: number }> {
  const [items, count] = await Promise.all([
    pool.query(
      `select id, org_id, name, description, definition, created_by, created_at
         from agent_workflows
        where org_id = $1
        order by created_at desc
        limit $2 offset $3`,
      [orgId, limit, offset]
    ),
    pool.query(`select count(*)::int as total from agent_workflows where org_id = $1`, [
      orgId,
    ]),
  ]);
  return {
    items: items.rows.map(mapWorkflow),
    total: count.rows[0]?.total ?? 0,
  };
}

export async function getCustomWorkflow(
  pool: Pool,
  orgId: string,
  id: string
): Promise<CustomWorkflow | null> {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    `select id, org_id, name, description, definition, created_by, created_at
       from agent_workflows
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows.length > 0 ? mapWorkflow(rows[0]) : null;
}

export async function createCustomWorkflow(
  pool: Pool,
  args: {
    orgId: string;
    name: string;
    description: string | null;
    definition: WorkflowDefinition;
    createdBy: string;
  }
): Promise<CustomWorkflow> {
  const { rows } = await pool.query(
    `insert into agent_workflows (org_id, name, description, definition, created_by)
     values ($1, $2, $3, $4::jsonb, $5)
     returning id, org_id, name, description, definition, created_by, created_at`,
    [
      args.orgId,
      args.name,
      args.description,
      JSON.stringify(args.definition),
      args.createdBy,
    ]
  );
  return mapWorkflow(rows[0]);
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export async function listRuns(
  pool: Pool,
  args: {
    orgId: string;
    status?: WorkflowRunStatus;
    workflowKey?: string;
    limit: number;
    offset: number;
  }
): Promise<{ items: RunSummary[]; total: number }> {
  const params: unknown[] = [args.orgId];
  let where = "org_id = $1";
  if (args.status) {
    params.push(args.status);
    where += ` and status = $${params.length}`;
  }
  if (args.workflowKey) {
    params.push(args.workflowKey);
    where += ` and workflow_key = $${params.length}`;
  }

  const listParams = [...params, args.limit, args.offset];
  const [items, count] = await Promise.all([
    pool.query(
      `select id, org_id, workflow_id, workflow_key, status, error,
              created_by, started_at, finished_at, created_at
         from agent_runs
        where ${where}
        order by created_at desc
        limit $${params.length + 1} offset $${params.length + 2}`,
      listParams
    ),
    pool.query(`select count(*)::int as total from agent_runs where ${where}`, params),
  ]);

  return {
    items: items.rows.map(mapRunSummary),
    total: count.rows[0]?.total ?? 0,
  };
}

export async function getRunDetail(
  pool: Pool,
  orgId: string,
  id: string
): Promise<RunDetail | null> {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    `select id, org_id, workflow_id, workflow_key, status, error, input, output,
            created_by, started_at, finished_at, created_at
       from agent_runs
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  if (rows.length === 0) return null;

  const stepRows = await pool.query(
    `select id, step_index, name, status, input, output, error, tokens, duration_ms, created_at
       from agent_steps
      where org_id = $1 and run_id = $2
      order by step_index asc`,
    [orgId, id]
  );

  const run = rows[0];
  return {
    ...mapRunSummary(run),
    input: run.input,
    output: run.output,
    steps: stepRows.rows.map(mapStep),
  };
}

// ── Mappers (db row -> typed model) ──────────────────────────────────────────

function mapWorkflow(row: Record<string, unknown>): CustomWorkflow {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    definition: row.definition as WorkflowDefinition,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: toIso(row.created_at),
  };
}

function mapRunSummary(row: Record<string, unknown>): RunSummary {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    workflowId: (row.workflow_id as string | null) ?? null,
    workflowKey: (row.workflow_key as string | null) ?? null,
    status: (row.status as WorkflowRunStatus) ?? "running",
    error: (row.error as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    startedAt: row.started_at ? toIso(row.started_at) : null,
    finishedAt: row.finished_at ? toIso(row.finished_at) : null,
    createdAt: toIso(row.created_at),
  };
}

function mapStep(row: Record<string, unknown>): StepRow {
  return {
    id: row.id as string,
    stepIndex: row.step_index as number,
    name: row.name as string,
    status: row.status as string,
    input: row.input ?? null,
    output: row.output ?? null,
    error: (row.error as string | null) ?? null,
    tokens: (row.tokens as number | null) ?? null,
    durationMs: (row.duration_ms as number | null) ?? null,
    createdAt: toIso(row.created_at),
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

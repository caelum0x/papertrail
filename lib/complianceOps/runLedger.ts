import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import {
  controlRunSchema,
  type ControlKind,
  type ControlRun,
  type RunStatus,
} from "@/lib/complianceOps/types";

// Repository for the compliance_control_runs ledger (db/migrations/0066). Every
// operationalized control (retention purge, chain integrity, access review)
// records its OUTCOME here so the console can show the last run without
// re-executing the control.
//
// Org-scoped by construction: org_id is always the first predicate and is the
// resolved server-side value passed by the caller, never a client value. All SQL
// is parameterized. `detail` is counts/ids only — the writers (retentionPurge,
// chainIntegrity) build it from aggregate integers, so no sensitive field ever
// reaches this table.

interface ControlRunRow {
  id: string;
  org_id: string;
  control: string;
  status: string;
  reason: string | null;
  detail: Record<string, unknown> | null;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// Maps a raw row through the Zod schema so a malformed row can never masquerade
// as a valid run. Returns null on a shape mismatch rather than throwing, keeping
// the ledger read best-effort for the console.
function mapRow(row: ControlRunRow): ControlRun | null {
  const parsed = controlRunSchema.safeParse({
    id: row.id,
    orgId: row.org_id,
    control: row.control,
    status: row.status,
    reason: row.reason,
    detail: row.detail ?? {},
    createdAt: toIso(row.created_at),
  });
  return parsed.success ? parsed.data : null;
}

export interface RecordRunInput {
  orgId: string;
  control: ControlKind;
  status: RunStatus;
  reason?: string | null;
  // Counts/ids only. Callers must not put claim/patient text here.
  detail?: Record<string, unknown>;
}

// Records one control run. Best-effort: an operational ledger write must never
// abort the control it describes, so failures are swallowed. Returns the created
// run on success, or null if the write failed.
export async function recordControlRun(
  input: RecordRunInput,
  pool: Pool = getPool()
): Promise<ControlRun | null> {
  try {
    const { rows } = await pool.query<ControlRunRow>(
      `insert into compliance_control_runs (org_id, control, status, reason, detail)
       values ($1, $2, $3, $4, $5::jsonb)
       returning id, org_id, control, status, reason, detail, created_at`,
      [
        input.orgId,
        input.control,
        input.status,
        input.reason ?? null,
        JSON.stringify(input.detail ?? {}),
      ]
    );
    return rows.length ? mapRow(rows[0]) : null;
  } catch {
    // Ledger writes are best-effort and must not fail the control.
    return null;
  }
}

// The most recent run of each control for an org, keyed by control kind. Absent
// controls are simply missing from the map (never fabricated). Best-effort: on a
// query error returns an empty map so the console degrades gracefully.
export async function latestRunsByControl(
  orgId: string,
  pool: Pool = getPool()
): Promise<Partial<Record<ControlKind, ControlRun>>> {
  try {
    const { rows } = await pool.query<ControlRunRow>(
      `select distinct on (control)
              id, org_id, control, status, reason, detail, created_at
         from compliance_control_runs
        where org_id = $1
        order by control, created_at desc`,
      [orgId]
    );
    const out: Partial<Record<ControlKind, ControlRun>> = {};
    for (const row of rows) {
      const run = mapRow(row);
      if (run) {
        out[run.control] = run;
      }
    }
    return out;
  } catch {
    return {};
  }
}

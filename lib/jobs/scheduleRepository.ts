import type { Pool } from "pg";
import type { Schedule } from "@/lib/jobs/types";
import { mapScheduleRow, type ScheduleRow, hasHandler } from "@/lib/jobs/queue";
import { computeNextRun } from "@/lib/jobs/scheduler";

// Org-scoped data access for cron-like schedules. Creating/updating a schedule
// recomputes next_run_at from its cron expression so the tick loop can pick it
// up. org_id is always the first predicate.

export interface ListSchedulesFilters {
  orgId: string;
  limit: number;
  offset: number;
}

export async function listSchedules(
  pool: Pool,
  filters: ListSchedulesFilters
): Promise<{ items: Schedule[]; total: number }> {
  const countRes = await pool.query<{ count: string }>(
    `select count(*)::text as count from schedules where org_id = $1`,
    [filters.orgId]
  );
  const total = Number(countRes.rows[0]?.count ?? 0);

  const { rows } = await pool.query<ScheduleRow>(
    `select * from schedules
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [filters.orgId, filters.limit, filters.offset]
  );
  return { items: rows.map(mapScheduleRow), total };
}

export async function getSchedule(
  pool: Pool,
  orgId: string,
  id: string
): Promise<Schedule | null> {
  const { rows } = await pool.query<ScheduleRow>(
    `select * from schedules where id = $1 and org_id = $2`,
    [id, orgId]
  );
  return rows.length ? mapScheduleRow(rows[0]) : null;
}

export interface CreateScheduleData {
  orgId: string;
  name: string;
  type: string;
  cron: string;
  payload: Record<string, unknown>;
  enabled: boolean;
}

export async function createSchedule(
  pool: Pool,
  data: CreateScheduleData
): Promise<Schedule> {
  const nextRun = data.enabled ? computeNextRun(data.cron) : null;
  const { rows } = await pool.query<ScheduleRow>(
    `insert into schedules (org_id, name, type, cron, payload, enabled, next_run_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7)
     returning *`,
    [
      data.orgId,
      data.name,
      data.type,
      data.cron,
      JSON.stringify(data.payload),
      data.enabled,
      nextRun,
    ]
  );
  return mapScheduleRow(rows[0]);
}

export interface UpdateScheduleData {
  name?: string;
  cron?: string;
  payload?: Record<string, unknown>;
  enabled?: boolean;
}

// Applies a partial update. If cron or enabled change, next_run_at is
// recomputed (or cleared when disabling). Returns null if the row doesn't exist.
export async function updateSchedule(
  pool: Pool,
  orgId: string,
  id: string,
  data: UpdateScheduleData
): Promise<Schedule | null> {
  const existing = await getSchedule(pool, orgId, id);
  if (!existing) return null;

  const nextName = data.name ?? existing.name;
  const nextCron = data.cron ?? existing.cron;
  const nextEnabled = data.enabled ?? existing.enabled;
  const nextPayload = data.payload ?? existing.payload;

  const cronOrEnabledChanged =
    (data.cron !== undefined && data.cron !== existing.cron) ||
    (data.enabled !== undefined && data.enabled !== existing.enabled);

  let nextRun = existing.nextRunAt;
  if (cronOrEnabledChanged) {
    nextRun = nextEnabled ? computeNextRun(nextCron) : null;
  }

  const { rows } = await pool.query<ScheduleRow>(
    `update schedules
        set name = $3,
            cron = $4,
            payload = $5::jsonb,
            enabled = $6,
            next_run_at = $7,
            updated_at = now()
      where id = $1 and org_id = $2
      returning *`,
    [id, orgId, nextName, nextCron, JSON.stringify(nextPayload), nextEnabled, nextRun]
  );
  return rows.length ? mapScheduleRow(rows[0]) : null;
}

export async function deleteSchedule(
  pool: Pool,
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from schedules where id = $1 and org_id = $2`,
    [id, orgId]
  );
  return (rowCount ?? 0) > 0;
}

// True if a handler is registered for the schedule's job type. Used by the API
// to warn (not block) when creating a schedule for an unknown type.
export function typeIsRunnable(type: string): boolean {
  return hasHandler(type);
}

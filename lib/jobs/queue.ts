import type { Pool, PoolClient } from "pg";
import type { Job, JobStatus, Schedule, TickResult } from "@/lib/jobs/types";

// The DB-backed job queue. All operations are org-scoped: org_id is always the
// first predicate so a caller can never read or mutate another tenant's rows.
//
// A worker loop (driven by processTick / POST /api/jobs/tick) claims the next
// runnable job atomically with FOR UPDATE SKIP LOCKED, dispatches it to the
// registered handler for its type, then records the outcome. Delayed jobs use
// run_after; retries use attempts/max_attempts.

// ---------------------------------------------------------------------------
// Row shapes (snake_case) and mappers
// ---------------------------------------------------------------------------

export interface JobRow {
  id: string;
  org_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: Date | string;
  locked_at: Date | string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ScheduleRow {
  id: string;
  org_id: string;
  name: string;
  type: string;
  cron: string;
  payload: Record<string, unknown> | null;
  enabled: boolean;
  last_run_at: Date | string | null;
  next_run_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function mapJobRow(row: JobRow): Job {
  return {
    id: row.id,
    orgId: row.org_id,
    type: row.type,
    payload: row.payload ?? {},
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: toIso(row.run_after) as string,
    lockedAt: toIso(row.locked_at),
    result: row.result ?? null,
    error: row.error,
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  };
}

export function mapScheduleRow(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    type: row.type,
    cron: row.cron,
    payload: row.payload ?? {},
    enabled: row.enabled,
    lastRunAt: toIso(row.last_run_at),
    nextRunAt: toIso(row.next_run_at),
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  };
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

export interface JobContext {
  job: Job;
  pool: Pool;
}

// A handler processes one job and returns a JSON-serializable result (stored on
// the job). Throwing marks the job failed (and eligible for retry).
export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

const HANDLERS = new Map<string, JobHandler>();

// Registers (or replaces) the handler for a job type. Idempotent by design so
// module reloads in dev don't accumulate duplicates.
export function registerHandler(type: string, handler: JobHandler): void {
  HANDLERS.set(type, handler);
}

export function getHandler(type: string): JobHandler | undefined {
  return HANDLERS.get(type);
}

export function hasHandler(type: string): boolean {
  return HANDLERS.has(type);
}

export function registeredJobTypes(): string[] {
  return Array.from(HANDLERS.keys()).sort();
}

// A built-in no-op handler so the demo has at least one runnable job type out of
// the box. It simply echoes its payload back as the job result.
registerHandler("noop", async ({ job }) => ({
  echoed: job.payload,
  ranAt: new Date().toISOString(),
}));

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export interface EnqueueOptions {
  runAfter?: string | Date | null;
  maxAttempts?: number;
}

// Enqueues a job for an org. Rejects unknown types (no registered handler) so a
// job can never sit permanently unrunnable.
export async function enqueue(
  pool: Pool,
  orgId: string,
  type: string,
  payload: Record<string, unknown> = {},
  opts: EnqueueOptions = {}
): Promise<Job> {
  if (!hasHandler(type)) {
    const err = new Error(`No handler registered for job type "${type}".`) as Error & {
      status: number;
    };
    err.status = 400;
    throw err;
  }

  const runAfter =
    opts.runAfter instanceof Date
      ? opts.runAfter.toISOString()
      : opts.runAfter ?? new Date().toISOString();

  const { rows } = await pool.query<JobRow>(
    `insert into jobs (org_id, type, payload, run_after, max_attempts)
     values ($1, $2, $3::jsonb, $4, coalesce($5, 3))
     returning *`,
    [orgId, type, JSON.stringify(payload), runAfter, opts.maxAttempts ?? null]
  );
  return mapJobRow(rows[0]);
}

// Atomically claims the next runnable job for an org (queued, run_after in the
// past), marking it running. Uses SKIP LOCKED so concurrent workers never grab
// the same row. Returns null if nothing is runnable.
export async function claimNext(pool: Pool, orgId: string): Promise<Job | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<JobRow>(
      `select * from jobs
        where org_id = $1
          and status = 'queued'
          and run_after <= now()
        order by run_after asc
        for update skip locked
        limit 1`,
      [orgId]
    );
    if (rows.length === 0) {
      await client.query("commit");
      return null;
    }
    const { rows: updated } = await client.query<JobRow>(
      `update jobs
          set status = 'running',
              attempts = attempts + 1,
              locked_at = now(),
              updated_at = now()
        where id = $1
        returning *`,
      [rows[0].id]
    );
    await client.query("commit");
    return mapJobRow(updated[0]);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// Marks a claimed job completed with its handler result.
export async function completeJob(
  pool: Pool,
  orgId: string,
  jobId: string,
  result: Record<string, unknown>
): Promise<Job | null> {
  const { rows } = await pool.query<JobRow>(
    `update jobs
        set status = 'completed',
            result = $3::jsonb,
            error = null,
            locked_at = null,
            updated_at = now()
      where id = $2 and org_id = $1
      returning *`,
    [orgId, jobId, JSON.stringify(result)]
  );
  return rows.length ? mapJobRow(rows[0]) : null;
}

// Records a failure. If attempts remain, the job is re-queued (with a small
// backoff via run_after); otherwise it is marked failed permanently.
export async function failJob(
  pool: Pool,
  orgId: string,
  jobId: string,
  message: string
): Promise<Job | null> {
  const { rows } = await pool.query<JobRow>(
    `update jobs
        set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
            run_after = case
              when attempts >= max_attempts then run_after
              else now() + (interval '30 seconds' * attempts)
            end,
            error = $3,
            locked_at = null,
            updated_at = now()
      where id = $2 and org_id = $1
      returning *`,
    [orgId, jobId, message.slice(0, 2000)]
  );
  return rows.length ? mapJobRow(rows[0]) : null;
}

// Runs a single claimed job through its registered handler, recording the
// outcome. Never throws — a handler failure becomes a failed/retried job.
export async function runJob(pool: Pool, job: Job): Promise<Job | null> {
  const handler = getHandler(job.type);
  if (!handler) {
    return failJob(pool, job.orgId, job.id, `No handler for type "${job.type}".`);
  }
  try {
    const result = await handler({ job, pool });
    return completeJob(pool, job.orgId, job.id, result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Job handler failed.";
    return failJob(pool, job.orgId, job.id, message);
  }
}

// ---------------------------------------------------------------------------
// Repository helpers (list / get / retry)
// ---------------------------------------------------------------------------

export interface ListJobsFilters {
  orgId: string;
  status?: JobStatus;
  type?: string;
  limit: number;
  offset: number;
}

export async function listJobs(
  pool: Pool,
  filters: ListJobsFilters
): Promise<{ items: Job[]; total: number }> {
  const where: string[] = ["org_id = $1"];
  const params: unknown[] = [filters.orgId];
  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.type) {
    params.push(filters.type);
    where.push(`type = $${params.length}`);
  }
  const whereSql = where.join(" and ");

  const countRes = await pool.query<{ count: string }>(
    `select count(*)::text as count from jobs where ${whereSql}`,
    params
  );
  const total = Number(countRes.rows[0]?.count ?? 0);

  const listParams = [...params, filters.limit, filters.offset];
  const { rows } = await pool.query<JobRow>(
    `select * from jobs
      where ${whereSql}
      order by created_at desc
      limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams
  );
  return { items: rows.map(mapJobRow), total };
}

export async function getJob(
  pool: Pool,
  orgId: string,
  jobId: string
): Promise<Job | null> {
  const { rows } = await pool.query<JobRow>(
    `select * from jobs where id = $1 and org_id = $2`,
    [jobId, orgId]
  );
  return rows.length ? mapJobRow(rows[0]) : null;
}

// Re-queues a completed/failed job so it can run again. Resets attempts and
// clears the previous result/error. Returns null if not found or still running.
export async function retryJob(
  pool: Pool,
  orgId: string,
  jobId: string
): Promise<Job | null> {
  const { rows } = await pool.query<JobRow>(
    `update jobs
        set status = 'queued',
            attempts = 0,
            run_after = now(),
            locked_at = null,
            result = null,
            error = null,
            updated_at = now()
      where id = $2 and org_id = $1
        and status in ('failed', 'completed')
      returning *`,
    [orgId, jobId]
  );
  return rows.length ? mapJobRow(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Tick: process due schedules (enqueue jobs) then drain the runnable queue.
// ---------------------------------------------------------------------------

export interface ProcessTickOptions {
  orgId: string;
  maxJobs?: number;
}

// Fires any due schedules for the org (enqueuing their jobs and advancing
// next_run_at) then runs up to maxJobs runnable jobs. Imported lazily to avoid a
// scheduler <-> queue circular import at module load.
export async function processTick(
  pool: Pool,
  opts: ProcessTickOptions
): Promise<TickResult> {
  const { dueSchedules, computeNextRun } = await import("@/lib/jobs/scheduler");
  const maxJobs = Math.min(Math.max(opts.maxJobs ?? 25, 1), 100);
  const now = new Date();

  let firedSchedules = 0;
  const due = await dueSchedules(pool, opts.orgId, now);
  for (const schedule of due) {
    if (!hasHandler(schedule.type)) {
      // Skip schedules whose handler is gone, but still advance next_run_at so
      // they don't spin every tick.
      await advanceSchedule(pool, schedule, now, computeNextRun);
      continue;
    }
    await enqueue(pool, schedule.orgId, schedule.type, schedule.payload);
    await advanceSchedule(pool, schedule, now, computeNextRun);
    firedSchedules += 1;
  }

  let processedJobs = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNext(pool, opts.orgId);
    if (!job) break;
    processedJobs += 1;
    const outcome = await runJob(pool, job);
    if (outcome?.status === "completed") completedJobs += 1;
    else failedJobs += 1;
  }

  return { processedJobs, completedJobs, failedJobs, firedSchedules };
}

async function advanceSchedule(
  pool: Pool,
  schedule: Schedule,
  now: Date,
  computeNextRun: (cron: string, from?: Date) => string | null
): Promise<void> {
  const next = computeNextRun(schedule.cron, now);
  await pool.query(
    `update schedules
        set last_run_at = $2,
            next_run_at = $3,
            updated_at = now()
      where id = $1 and org_id = $4`,
    [schedule.id, now.toISOString(), next, schedule.orgId]
  );
}

// Re-export for callers that want the raw pool client type.
export type { PoolClient };

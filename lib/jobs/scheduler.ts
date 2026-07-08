import type { Pool } from "pg";
import type { Schedule } from "@/lib/jobs/types";
import { mapScheduleRow, type ScheduleRow } from "@/lib/jobs/queue";

// Cron-like scheduling. Supports the standard 5-field crontab format in UTC:
//
//   ┌─ minute (0-59)
//   │ ┌─ hour (0-23)
//   │ │ ┌─ day of month (1-31)
//   │ │ │ ┌─ month (1-12)
//   │ │ │ │ ┌─ day of week (0-6, Sunday=0)
//   * * * * *
//
// Each field supports: '*', a single value, a list (a,b,c), a range (a-b), and
// step (*/n or a-b/n). No macros. This is intentionally small and dependency
// free — enough for the demo's periodic jobs (e.g. "0 * * * *" hourly).

interface CronField {
  values: Set<number>;
}

const FIELD_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week
];

function parseField(raw: string, min: number, max: number): CronField | null {
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (token.length === 0) return null;

    let range = token;
    let step = 1;
    const slash = token.indexOf("/");
    if (slash !== -1) {
      range = token.slice(0, slash);
      const stepStr = token.slice(slash + 1);
      step = Number(stepStr);
      if (!Number.isInteger(step) || step <= 0) return null;
    }

    let lo = min;
    let hi = max;
    if (range !== "*") {
      const dash = range.indexOf("-");
      if (dash !== -1) {
        lo = Number(range.slice(0, dash));
        hi = Number(range.slice(dash + 1));
      } else {
        lo = Number(range);
        hi = Number(range);
      }
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
      if (lo < min || hi > max || lo > hi) return null;
    }

    for (let v = lo; v <= hi; v += step) {
      values.add(v);
    }
  }
  return values.size > 0 ? { values } : null;
}

function parseCron(cron: string): CronField[] | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const parsed: CronField[] = [];
  for (let i = 0; i < 5; i++) {
    const [min, max] = FIELD_RANGES[i];
    const field = parseField(fields[i], min, max);
    if (!field) return null;
    parsed.push(field);
  }
  return parsed;
}

// True if `cron` is a well-formed 5-field expression this parser understands.
export function isValidCron(cron: string): boolean {
  return parseCron(cron) !== null;
}

// Computes the next UTC time (strictly after `from`) at which `cron` fires.
// Returns an ISO string, or null if the cron is invalid. Scans minute-by-minute
// for up to ~2 years, which always terminates for any valid crontab expression.
export function computeNextRun(cron: string, from: Date = new Date()): string | null {
  const fields = parseCron(cron);
  if (!fields) return null;

  const [minute, hour, dom, month, dow] = fields;

  // Start from the next whole minute after `from` (strictly after).
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  const MAX_MINUTES = 366 * 2 * 24 * 60; // ~2 years of minutes
  for (let i = 0; i < MAX_MINUTES; i++) {
    const m = cursor.getUTCMinutes();
    const h = cursor.getUTCHours();
    const d = cursor.getUTCDate();
    const mo = cursor.getUTCMonth() + 1;
    const wd = cursor.getUTCDay();

    // Standard cron semantics: if BOTH day-of-month and day-of-week are
    // restricted (not '*'), the job runs when EITHER matches. Otherwise both
    // must match.
    const domRestricted = dom.values.size !== 31;
    const dowRestricted = dow.values.size !== 7;
    let dayMatch: boolean;
    if (domRestricted && dowRestricted) {
      dayMatch = dom.values.has(d) || dow.values.has(wd);
    } else {
      dayMatch = dom.values.has(d) && dow.values.has(wd);
    }

    if (
      minute.values.has(m) &&
      hour.values.has(h) &&
      month.values.has(mo) &&
      dayMatch
    ) {
      return cursor.toISOString();
    }

    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  return null;
}

// Returns enabled schedules for an org whose next_run_at is due (<= now) or
// unset. Ordered oldest-due first so a backlog is drained deterministically.
export async function dueSchedules(
  pool: Pool,
  orgId: string,
  now: Date = new Date()
): Promise<Schedule[]> {
  const { rows } = await pool.query<ScheduleRow>(
    `select * from schedules
      where org_id = $1
        and enabled = true
        and (next_run_at is null or next_run_at <= $2)
      order by next_run_at asc nulls first, created_at asc`,
    [orgId, now.toISOString()]
  );
  return rows.map(mapScheduleRow);
}

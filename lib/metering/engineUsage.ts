import type { Pool } from "pg";
import {
  recordEngineUsageSchema,
  summarizeUsageSchema,
  type EngineUsageRow,
  type UsageSummary,
} from "./engineUsage.schemas";

// Per-engine usage metering. Every evidence/bio engine call and its Claude-token
// cost is recorded here per org, so billing and quotas can roll up consumption by
// engine and by token spend. Pure data access: parameterized SQL only, explicit
// errors, org_id ALWAYS the first predicate so a caller can never read or write
// another tenant's rows.

// Deterministic normaliser for a single metered charge. Returns the canonical
// (units, claudeTokens) pair a caller should record: units floored at 1 (a call
// always costs at least one unit) and tokens floored at 0. Kept pure so callers
// and tests can reason about a charge without touching the database.
export function meter(input?: {
  units?: number;
  claudeTokens?: number;
}): { units: number; claudeTokens: number } {
  const rawUnits = input?.units;
  const rawTokens = input?.claudeTokens;
  const units =
    typeof rawUnits === "number" && Number.isFinite(rawUnits)
      ? Math.max(1, Math.floor(rawUnits))
      : 1;
  const claudeTokens =
    typeof rawTokens === "number" && Number.isFinite(rawTokens)
      ? Math.max(0, Math.floor(rawTokens))
      : 0;
  return { units, claudeTokens };
}

// Records one metered engine call for an org. Validates the input so a mis-wired
// caller cannot insert malformed or negative rows. Throws on invalid input (a
// billing signal must be trustworthy — unlike best-effort audit/telemetry, we do
// not silently drop a charge).
export async function recordEngineUsage(
  pool: Pool,
  input: {
    orgId: string;
    engine: string;
    units?: number;
    claudeTokens?: number;
  }
): Promise<void> {
  const parsed = recordEngineUsageSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid engine usage input: ${parsed.error.message}`);
  }
  const data = parsed.data;
  await pool.query(
    `insert into engine_usage (org_id, engine, units, claude_tokens)
       values ($1, $2, $3, $4)`,
    [data.orgId, data.engine, data.units, data.claudeTokens]
  );
}

interface SummaryRow {
  engine: string;
  calls: string | number;
  units: string | number;
  claude_tokens: string | number;
}

function toEngineRow(row: SummaryRow): EngineUsageRow {
  return {
    engine: row.engine,
    calls: Number(row.calls),
    units: Number(row.units),
    claudeTokens: Number(row.claude_tokens),
  };
}

// Rolls up an org's engine usage: per-engine call counts, unit totals, and token
// totals, plus org-wide totals across every engine. Optionally narrowed to events
// at/after `since`. org_id is the first predicate; engines are returned
// heaviest-first (by units) for a stable, useful ordering.
export async function summarizeUsage(
  pool: Pool,
  input: { orgId: string; since?: Date }
): Promise<UsageSummary> {
  const parsed = summarizeUsageSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid usage summary input: ${parsed.error.message}`);
  }
  const { orgId, since } = parsed.data;

  const values: unknown[] = [orgId];
  let where = "org_id = $1";
  if (since) {
    values.push(since.toISOString());
    where += ` and occurred_at >= $${values.length}`;
  }

  const { rows } = await pool.query<SummaryRow>(
    `select engine,
            count(*)::int as calls,
            coalesce(sum(units), 0)::int as units,
            coalesce(sum(claude_tokens), 0)::bigint as claude_tokens
       from engine_usage
      where ${where}
      group by engine
      order by units desc, engine asc`,
    values
  );

  const engines = rows.map(toEngineRow);
  const totals = engines.reduce(
    (acc, e) => ({
      calls: acc.calls + e.calls,
      units: acc.units + e.units,
      claudeTokens: acc.claudeTokens + e.claudeTokens,
    }),
    { calls: 0, units: 0, claudeTokens: 0 }
  );

  return { engines, totals };
}

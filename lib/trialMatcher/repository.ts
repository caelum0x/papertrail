// DATA ACCESS for the CLINICAL TRIAL MATCHER. Every method is org-scoped: org_id is always
// the first predicate so a caller can never read another tenant's rows. A run and its ranked
// matches are written in a single transaction so they never drift out of sync.
//
// Governance: the raw notes text is NEVER persisted — only note_char_count and the extracted,
// de-identified profile (each field carrying a verbatim note span) are stored. Matches (which
// belong to a run) are org-scoped transitively through the run's FK; reads join back to
// trial_match_runs and filter that run's org_id so a match can never leak cross-tenant.

import type { Pool } from "pg";
import type {
  CriterionAssessment,
  PatientProfile,
  TrialMatch,
  TrialMatchRow,
  TrialMatchRunDetail,
  TrialMatchRunRow,
} from "./schemas";

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

interface RunRow {
  id: string;
  patient_summary: string | null;
  profile: PatientProfile;
  note_char_count: number | null;
  created_at: Date | string;
  match_count: string | number;
}

function mapRun(row: RunRow): TrialMatchRunRow {
  return {
    id: row.id,
    patient_summary: row.patient_summary,
    profile: row.profile,
    note_char_count: row.note_char_count,
    created_at: toIso(row.created_at),
    match_count: Number(row.match_count) || 0,
  };
}

interface MatchRow {
  id: string;
  nct_id: string | null;
  title: string | null;
  url: string | null;
  phase: string | null;
  overall_status: string | null;
  eligibility_score: string | number | null;
  verdict: string | null;
  criteria: CriterionAssessment[];
  created_at: Date | string;
}

function mapMatch(row: MatchRow): TrialMatchRow {
  return {
    id: row.id,
    nct_id: row.nct_id,
    title: row.title,
    url: row.url,
    phase: row.phase,
    overall_status: row.overall_status,
    eligibility_score: toNumOrNull(row.eligibility_score),
    verdict: row.verdict,
    criteria: Array.isArray(row.criteria) ? row.criteria : [],
    created_at: toIso(row.created_at),
  };
}

export interface CreateRunInput {
  patient_summary: string | null;
  profile: PatientProfile;
  note_char_count: number | null;
  matches: TrialMatch[];
}

/**
 * Insert a match run and its ranked matches in a single transaction. Returns the persisted
 * run header with its match count. org_id scopes the run; matches inherit scoping via the
 * run FK. The raw notes are never passed here — only the de-identified profile and counts.
 */
export async function createRun(
  pool: Pool,
  orgId: string,
  userId: string,
  input: CreateRunInput
): Promise<TrialMatchRunRow> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const { rows } = await client.query<{
      id: string;
      patient_summary: string | null;
      profile: PatientProfile;
      note_char_count: number | null;
      created_at: Date | string;
    }>(
      `insert into trial_match_runs
         (org_id, created_by, patient_summary, profile, note_char_count)
       values ($1, $2, $3, $4, $5)
       returning id, patient_summary, profile, note_char_count, created_at`,
      [
        orgId,
        userId,
        input.patient_summary,
        JSON.stringify(input.profile),
        input.note_char_count,
      ]
    );
    const runRow = rows[0];

    for (const m of input.matches) {
      await client.query(
        `insert into trial_matches
           (run_id, nct_id, title, url, phase, overall_status, eligibility_score, verdict, criteria)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          runRow.id,
          m.nctId,
          m.title,
          m.url,
          m.phase,
          m.overallStatus,
          m.eligibility_score,
          m.verdict,
          JSON.stringify(m.criteria),
        ]
      );
    }

    await client.query("commit");

    return mapRun({
      id: runRow.id,
      patient_summary: runRow.patient_summary,
      profile: runRow.profile,
      note_char_count: runRow.note_char_count,
      created_at: runRow.created_at,
      match_count: input.matches.length,
    });
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * List match runs for an org, newest first, with a match count per run. Paginated.
 * Filters by org_id so only the caller's org's runs are returned.
 */
export async function listRuns(
  pool: Pool,
  orgId: string,
  opts: { limit: number; offset: number }
): Promise<{ runs: TrialMatchRunRow[]; total: number }> {
  const { rows } = await pool.query<RunRow>(
    `select r.id, r.patient_summary, r.profile, r.note_char_count, r.created_at,
            count(m.id) as match_count
       from trial_match_runs r
       left join trial_matches m on m.run_id = r.id
      where r.org_id = $1
      group by r.id
      order by r.created_at desc
      limit $2 offset $3`,
    [orgId, opts.limit, opts.offset]
  );

  const { rows: countRows } = await pool.query<{ total: string }>(
    `select count(*) as total from trial_match_runs where org_id = $1`,
    [orgId]
  );
  const total = Number(countRows[0]?.total ?? 0);

  return { runs: rows.map(mapRun), total };
}

/**
 * Fetch one run with its ranked matches, org-scoped. Returns null if the run doesn't exist
 * or belongs to another org. Matches are re-scoped through the run's org_id in the join.
 */
export async function getRun(
  pool: Pool,
  orgId: string,
  id: string
): Promise<TrialMatchRunDetail | null> {
  const { rows } = await pool.query<RunRow>(
    `select r.id, r.patient_summary, r.profile, r.note_char_count, r.created_at,
            (select count(*) from trial_matches m where m.run_id = r.id) as match_count
       from trial_match_runs r
      where r.org_id = $1 and r.id = $2`,
    [orgId, id]
  );
  if (rows.length === 0) return null;

  const { rows: matchRows } = await pool.query<MatchRow>(
    `select m.id, m.nct_id, m.title, m.url, m.phase, m.overall_status,
            m.eligibility_score, m.verdict, m.criteria, m.created_at
       from trial_matches m
       join trial_match_runs r on r.id = m.run_id
      where r.org_id = $1 and m.run_id = $2
      order by m.eligibility_score desc nulls last, m.created_at asc`,
    [orgId, id]
  );

  return { run: mapRun(rows[0]), matches: matchRows.map(mapMatch) };
}

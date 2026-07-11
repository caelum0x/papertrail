import type { Pool } from "pg";

// Legal-hold governance. A legal hold preserves everything PaperTrail holds about
// a data SUBJECT (identified by a stable string — typically an email) so it cannot
// be purged while litigation or a regulatory obligation is active.
//
// Every function here is org-scoped: org_id is ALWAYS the first predicate, and the
// org id is the RESOLVED server-side value (ctx.org.id) — never a client-supplied
// org id. All SQL is parameterized; no value is interpolated.
//
// The retention-purge worker consults isUnderLegalHold() BEFORE deleting or
// anonymizing a subject's rows. A held subject is skipped entirely — an active
// hold is the safe, fail-closed default: preserve rather than destroy.

export interface LegalHold {
  id: string;
  orgId: string;
  subject: string;
  reason: string | null;
  active: boolean;
  placedBy: string | null;
  placedAt: string | null;
  releasedAt: string | null;
}

export interface PlaceLegalHoldInput {
  subject: string;
  reason?: string | null;
  placedBy?: string | null;
}

interface LegalHoldRow {
  id: string;
  org_id: string;
  subject: string;
  reason: string | null;
  active: boolean;
  placed_by: string | null;
  placed_at: Date | string | null;
  released_at: Date | string | null;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapHold(row: LegalHoldRow): LegalHold {
  return {
    id: row.id,
    orgId: row.org_id,
    subject: row.subject,
    reason: row.reason,
    active: row.active,
    placedBy: row.placed_by,
    placedAt: toIso(row.placed_at),
    releasedAt: toIso(row.released_at),
  };
}

// Normalizes a subject identifier for consistent matching. Subjects are typically
// emails, which are case-insensitive; we lower-case and trim so a hold placed on
// "Alice@Lab.org" matches an "alice@lab.org" retention lookup.
function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase();
}

// Lists the org's legal holds, newest-first. When activeOnly is true, only holds
// that are still in force are returned (the view the retention worker cares about).
export async function listLegalHolds(
  pool: Pool,
  orgId: string,
  activeOnly = false
): Promise<LegalHold[]> {
  const params: unknown[] = [orgId];
  let where = "org_id = $1";
  if (activeOnly) {
    where += " and active = true";
  }
  const { rows } = await pool.query<LegalHoldRow>(
    `select id, org_id, subject, reason, active, placed_by, placed_at, released_at
       from legal_holds
      where ${where}
      order by placed_at desc nulls last, id desc`,
    params
  );
  return rows.map(mapHold);
}

// Places a legal hold on a subject. If an ACTIVE hold already exists for the same
// (org, subject) the existing hold is returned unchanged — placing is idempotent,
// so re-running never creates duplicate active holds for one subject.
export async function placeLegalHold(
  pool: Pool,
  orgId: string,
  input: PlaceLegalHoldInput
): Promise<LegalHold> {
  const subject = normalizeSubject(input.subject);

  const existing = await pool.query<LegalHoldRow>(
    `select id, org_id, subject, reason, active, placed_by, placed_at, released_at
       from legal_holds
      where org_id = $1 and subject = $2 and active = true
      limit 1`,
    [orgId, subject]
  );
  if (existing.rows.length) {
    return mapHold(existing.rows[0]);
  }

  const { rows } = await pool.query<LegalHoldRow>(
    `insert into legal_holds (org_id, subject, reason, active, placed_by)
     values ($1, $2, $3, true, $4)
     returning id, org_id, subject, reason, active, placed_by, placed_at, released_at`,
    [orgId, subject, input.reason ?? null, input.placedBy ?? null]
  );
  return mapHold(rows[0]);
}

// Releases (deactivates) a legal hold by id, scoped to the org. Only an active
// hold is released — a no-op on an already-released or non-existent hold returns
// null so the caller can surface an honest "nothing to release".
export async function releaseLegalHold(
  pool: Pool,
  orgId: string,
  holdId: string
): Promise<LegalHold | null> {
  const { rows } = await pool.query<LegalHoldRow>(
    `update legal_holds
        set active = false, released_at = now()
      where org_id = $1 and id = $2 and active = true
      returning id, org_id, subject, reason, active, placed_by, placed_at, released_at`,
    [orgId, holdId]
  );
  return rows.length ? mapHold(rows[0]) : null;
}

// Predicate the retention-purge worker consults BEFORE deleting/anonymizing a
// subject's data: returns true if an ACTIVE hold covers this (org, subject).
// Subject matching is normalized (lower/trim) so it lines up with how holds are
// stored. Org-scoped and parameterized. Fail-closed intent: if a hold exists, the
// worker must preserve the subject's data.
export async function isUnderLegalHold(
  pool: Pool,
  orgId: string,
  subject: string
): Promise<boolean> {
  const normalized = normalizeSubject(subject);
  const { rows } = await pool.query<{ held: boolean }>(
    `select exists (
       select 1 from legal_holds
        where org_id = $1 and subject = $2 and active = true
     ) as held`,
    [orgId, normalized]
  );
  return rows[0]?.held === true;
}

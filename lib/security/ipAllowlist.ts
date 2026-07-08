import { getPool } from "@/lib/db";
import type { IpAllowlistEntry } from "@/lib/security/types";

// Repository for the per-org IP allowlist. All queries are org-scoped so a
// caller can only ever read or mutate their own org's entries.

interface AllowlistRow {
  id: string;
  org_id: string;
  cidr: string;
  note: string | null;
  created_at: string | Date;
}

function toEntry(row: AllowlistRow): IpAllowlistEntry {
  return {
    id: row.id,
    org_id: row.org_id,
    cidr: row.cidr,
    note: row.note ?? null,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

export async function listIpAllowlist(
  orgId: string,
  opts: { limit: number; offset: number }
): Promise<{ items: IpAllowlistEntry[]; total: number }> {
  const pool = getPool();
  const [{ rows }, countRes] = await Promise.all([
    pool.query<AllowlistRow>(
      `select id, org_id, cidr, note, created_at
         from ip_allowlist
        where org_id = $1
        order by created_at desc
        limit $2 offset $3`,
      [orgId, opts.limit, opts.offset]
    ),
    pool.query<{ count: string }>(
      `select count(*)::text as count from ip_allowlist where org_id = $1`,
      [orgId]
    ),
  ]);
  return {
    items: rows.map(toEntry),
    total: Number(countRes.rows[0]?.count ?? "0"),
  };
}

export async function getIpAllowlistEntry(
  orgId: string,
  id: string
): Promise<IpAllowlistEntry | null> {
  const { rows } = await getPool().query<AllowlistRow>(
    `select id, org_id, cidr, note, created_at
       from ip_allowlist
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows.length > 0 ? toEntry(rows[0]) : null;
}

export interface AddIpAllowlistInput {
  orgId: string;
  cidr: string;
  note: string | null;
}

export async function addIpAllowlistEntry(
  input: AddIpAllowlistInput
): Promise<IpAllowlistEntry> {
  const { rows } = await getPool().query<AllowlistRow>(
    `insert into ip_allowlist (org_id, cidr, note)
       values ($1, $2, $3)
     returning id, org_id, cidr, note, created_at`,
    [input.orgId, input.cidr, input.note]
  );
  return toEntry(rows[0]);
}

// Returns true if a row was deleted (i.e. it existed and belonged to the org).
export async function deleteIpAllowlistEntry(
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `delete from ip_allowlist where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

export async function countIpAllowlist(orgId: string): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `select count(*)::text as count from ip_allowlist where org_id = $1`,
    [orgId]
  );
  return Number(rows[0]?.count ?? "0");
}

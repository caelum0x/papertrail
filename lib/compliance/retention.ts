import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type { RetentionPolicy } from "@/lib/compliance/types";

// Data retention policies: how long (retain_days) records of a given entity_type
// must be kept before they may be purged. One policy per (org, entity_type) —
// upserting replaces the window rather than accumulating duplicates.

interface RetentionRow {
  id: string;
  org_id: string;
  entity_type: string;
  retain_days: number | string;
  created_at: string | Date;
}

function mapRow(row: RetentionRow): RetentionPolicy {
  return {
    id: row.id,
    org_id: row.org_id,
    entity_type: row.entity_type,
    retain_days: Number(row.retain_days),
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export async function listRetentionPolicies(
  orgId: string,
  pool: Pool = getPool()
): Promise<RetentionPolicy[]> {
  const { rows } = await pool.query<RetentionRow>(
    `select id, org_id, entity_type, retain_days, created_at
       from retention_policies
      where org_id = $1
      order by entity_type asc`,
    [orgId]
  );
  return rows.map(mapRow);
}

export interface UpsertRetentionInput {
  orgId: string;
  entityType: string;
  retainDays: number;
}

// Create or update the retention window for an entity type. Idempotent per
// (org, entity_type).
export async function upsertRetentionPolicy(
  input: UpsertRetentionInput,
  pool: Pool = getPool()
): Promise<RetentionPolicy> {
  const { rows } = await pool.query<RetentionRow>(
    `insert into retention_policies (org_id, entity_type, retain_days)
     values ($1, $2, $3)
     on conflict (org_id, entity_type)
       do update set retain_days = excluded.retain_days
     returning id, org_id, entity_type, retain_days, created_at`,
    [input.orgId, input.entityType, input.retainDays]
  );
  return mapRow(rows[0]);
}

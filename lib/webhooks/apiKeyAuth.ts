import type { Pool } from "pg";
import { hashApiKey } from "@/lib/admin-audit/apiKeys";

// Authentication for the public API (app/api/v1/*). Unlike the console routes
// (session + membership via withOrg), public API clients present a raw API key
// in the `x-api-key` header. We hash it (SHA-256, matching how keys are stored)
// and look up the owning, non-revoked org. Returns the org id + key id, or null
// if the key is missing/unknown/revoked.

export interface ResolvedApiKey {
  orgId: string;
  keyId: string;
}

export async function resolveOrgFromApiKey(
  pool: Pool,
  rawKey: string | null
): Promise<ResolvedApiKey | null> {
  const key = rawKey?.trim();
  if (!key) return null;

  const keyHash = hashApiKey(key);
  const { rows } = await pool.query(
    `select id, org_id
       from api_keys
      where key_hash = $1
        and revoked_at is null
      limit 1`,
    [keyHash]
  );
  const row = rows[0];
  if (!row) return null;

  // Best-effort last-used stamp; never block auth on this write.
  try {
    await pool.query(
      `update api_keys set last_used_at = now() where id = $1`,
      [row.id]
    );
  } catch {
    // ignore
  }

  return { orgId: row.org_id, keyId: row.id };
}

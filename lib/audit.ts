import type { Pool } from "pg";

// Append-only audit trail. Modules call writeAudit after a meaningful mutation
// so admins can review who did what. Failures here must never break the caller,
// so writeAudit swallows its own errors (logging via the pool is best-effort).

export interface AuditEntry {
  orgId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(pool: Pool, entry: AuditEntry): Promise<void> {
  try {
    await pool.query(
      `insert into audit_log (org_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        entry.orgId,
        entry.userId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ]
    );
  } catch {
    // Audit logging is best-effort and must not fail the originating request.
  }
}

import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import type { PurgeItem, PurgeResult } from "@/lib/complianceOps/types";

// Retention ENFORCEMENT. The retention_policies table (db/migrations/0028) stores
// a per-(org, entity_type) window in days; nothing ever ACTED on it. This module
// reads each org's policies and actually purges (or anonymizes) rows older than
// their window.
//
// Design:
//   * A fixed internal REGISTRY maps a known entity_type -> a concrete governed
//     table, its timestamp column, and a strategy. The entity_type from the
//     policy row is a client-chosen label, but it is only ever COMPARED against
//     this registry — it never reaches SQL as an identifier, so there is no
//     injection path. Table/column names come solely from the registry constant.
//   * Two strategies:
//       - "anonymize": null out the free-text column(s) in place, keeping the row
//         so the audit/provenance trail survives. Used for `claims`, whose `text`
//         may carry the claim/patient wording we must not retain past its window.
//       - "delete": hard-delete the row. Used for `evidence_reports`, a derived
//         artifact that is regenerated on demand.
//   * An entity_type with no registry entry is SKIPPED (reported, never guessed)
//     — the safe default: we never delete from a table we don't recognize.
//   * Every statement is org-scoped: org_id is the FIRST predicate, always the
//     resolved server-side org id. The age cutoff is computed in SQL from a
//     parameterized day count.
//   * Best-effort: one entity_type's failure is captured on its item and does not
//     abort the rest of the org's purge. Returns counts only — no row contents.

type Strategy = "delete" | "anonymize";

interface RegistryEntry {
  // The governed table. A fixed internal constant — never a client value.
  table: string;
  // The timestamp column the retention window is measured against.
  timeColumn: string;
  strategy: Strategy;
  // For "anonymize": the free-text columns to null out in place. Fixed internal
  // constants. Empty for "delete".
  anonymizeColumns: readonly string[];
}

// Defense in depth: SQL identifiers (table/column names) cannot be parameterized, so
// they come only from the fixed REGISTRY below. This guard fails CLOSED if any identifier
// ever fails to match a strict [a-z_][a-z0-9_]* shape — so a future registry edit or
// tampering can never inject SQL through an identifier position.
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
function ident(name: string): string {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Unsafe SQL identifier blocked: ${JSON.stringify(name)}`);
  }
  return name;
}

// The ONLY entity_types this enforcer knows how to act on. Extend deliberately;
// an unknown entity_type is skipped rather than acted on.
const REGISTRY: Readonly<Record<string, RegistryEntry>> = {
  // Claims carry the verbatim claim wording; past its window we scrub the text
  // but keep the row (status/timestamps) so downstream audit links stay intact.
  claims: {
    table: "claims",
    timeColumn: "created_at",
    strategy: "anonymize",
    anonymizeColumns: ["text", "cited_source_url"],
  },
  // Derived composite reports: hard-deleted past their window.
  evidence_reports: {
    table: "evidence_reports",
    timeColumn: "created_at",
    strategy: "delete",
    anonymizeColumns: [],
  },
};

interface PolicyRow {
  entity_type: string;
  retain_days: number | string;
}

// Reads the org's configured retention policies. Org-scoped, parameterized.
async function loadPolicies(pool: Pool, orgId: string): Promise<PolicyRow[]> {
  const { rows } = await pool.query<PolicyRow>(
    `select entity_type, retain_days
       from retention_policies
      where org_id = $1
      order by entity_type asc`,
    [orgId]
  );
  return rows;
}

// Hard-deletes rows older than `days` in a registry table, scoped to the org.
// Table/time-column come from the registry constant (not client input); the age
// cutoff is a parameterized day count. Returns the affected row count.
async function purgeDelete(
  pool: Pool,
  entry: RegistryEntry,
  orgId: string,
  days: number
): Promise<number> {
  const { rowCount } = await pool.query(
    `delete from ${ident(entry.table)}
      where org_id = $1
        and ${ident(entry.timeColumn)} < now() - ($2 || ' days')::interval`,
    [orgId, String(days)]
  );
  return rowCount ?? 0;
}

// Anonymizes rows older than `days` by setting the registry's free-text columns
// to null in place, scoped to the org. Only rows still carrying text are touched
// (so re-runs are idempotent and the count reflects real work). Returns the
// affected row count.
async function purgeAnonymize(
  pool: Pool,
  entry: RegistryEntry,
  orgId: string,
  days: number
): Promise<number> {
  if (entry.anonymizeColumns.length === 0) return 0;

  // Build "col = null" assignments and a "any col is not null" guard from fixed
  // registry column names (never client values), so re-running skips already
  // scrubbed rows and the count is meaningful.
  const setClause = entry.anonymizeColumns.map((c) => `${ident(c)} = null`).join(", ");
  const notNullGuard = entry.anonymizeColumns
    .map((c) => `${ident(c)} is not null`)
    .join(" or ");

  const { rowCount } = await pool.query(
    `update ${ident(entry.table)}
        set ${setClause}
      where org_id = $1
        and ${ident(entry.timeColumn)} < now() - ($2 || ' days')::interval
        and (${notNullGuard})`,
    [orgId, String(days)]
  );
  return rowCount ?? 0;
}

// Enforces every retention policy for ONE org. Best-effort per entity_type: a
// failure is recorded on that item and the sweep continues. Returns per-item
// outcomes plus aggregate counts — never any row contents.
export async function purgeOrgRetention(
  orgId: string,
  pool: Pool = getPool()
): Promise<PurgeResult> {
  const policies = await loadPolicies(pool, orgId);

  const items: PurgeItem[] = [];
  let deleted = 0;
  let anonymized = 0;
  let skipped = 0;
  let errors = 0;

  for (const policy of policies) {
    const retainDays = Number(policy.retain_days);
    const entry = REGISTRY[policy.entity_type];

    // Unknown entity_type, or a degenerate/negative window: skip rather than act.
    if (!entry || !Number.isFinite(retainDays) || retainDays < 0) {
      skipped += 1;
      items.push({
        entityType: policy.entity_type,
        action: "skipped",
        affected: 0,
        retainDays: Number.isFinite(retainDays) && retainDays >= 0 ? retainDays : 0,
        error: null,
      });
      continue;
    }

    try {
      if (entry.strategy === "delete") {
        const affected = await purgeDelete(pool, entry, orgId, retainDays);
        deleted += affected;
        items.push({
          entityType: policy.entity_type,
          action: "delete",
          affected,
          retainDays,
          error: null,
        });
      } else {
        const affected = await purgeAnonymize(pool, entry, orgId, retainDays);
        anonymized += affected;
        items.push({
          entityType: policy.entity_type,
          action: "anonymize",
          affected,
          retainDays,
          error: null,
        });
      }
    } catch (err) {
      errors += 1;
      items.push({
        entityType: policy.entity_type,
        action: entry.strategy,
        affected: 0,
        retainDays,
        // A short, non-sensitive message only.
        error: err instanceof Error ? err.message : "purge failed",
      });
    }
  }

  return {
    orgId,
    policies: policies.length,
    deleted,
    anonymized,
    skipped,
    errors,
    items,
    ranAt: new Date().toISOString(),
  };
}

import { getPool } from "@/lib/db";
import {
  type RlsTableStatus,
  type SecurityStatus,
  type SecurityPolicyKind,
} from "@/lib/security/types";
import { listSecurityPolicies } from "@/lib/security/policies";
import { countIpAllowlist } from "@/lib/security/ipAllowlist";

// The core tenant tables that migration 0033 places under row-level security.
// Kept in sync with the DO block in db/migrations/0033_security-rls.sql.
export const RLS_TENANT_TABLES = [
  "claims",
  "documents",
  "evidence_items",
  "reports",
  "reviews",
  "projects",
  "notifications",
  "security_policies",
  "ip_allowlist",
] as const;

const ISOLATION_POLICY_NAME = "org_isolation";

interface RlsRow {
  table_name: string;
  rls_enabled: boolean;
  policy_count: string;
  has_isolation: boolean;
}

// Reads per-table RLS state from the Postgres catalog. This is org-agnostic
// (RLS config is database-wide), but it is surfaced per-org on the status page
// so an org admin can confirm their data is isolated at the database level.
async function readRlsStatus(): Promise<RlsTableStatus[]> {
  const { rows } = await getPool().query<RlsRow>(
    `select
        c.relname as table_name,
        c.relrowsecurity as rls_enabled,
        count(p.polname)::text as policy_count,
        bool_or(p.polname = $2) as has_isolation
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
     where n.nspname = 'public'
       and c.relname = any($1)
     group by c.relname, c.relrowsecurity
     order by c.relname asc`,
    [RLS_TENANT_TABLES as unknown as string[], ISOLATION_POLICY_NAME]
  );

  const byName = new Map(rows.map((r) => [r.table_name, r]));
  // Report every expected table, even ones missing from the catalog (not yet
  // migrated), so the UI can show them as "not isolated" rather than hiding them.
  return RLS_TENANT_TABLES.map((table) => {
    const row = byName.get(table);
    return {
      table,
      rls_enabled: row?.rls_enabled ?? false,
      policy_count: row ? Number(row.policy_count) : 0,
      isolation_policy: row?.has_isolation ?? false,
    } satisfies RlsTableStatus;
  });
}

// Aggregates the full security posture for an org: database-level RLS coverage
// plus the org's configured policies and allowlist size.
export async function getSecurityStatus(
  orgId: string
): Promise<SecurityStatus> {
  const [tables, policies, allowlistCount] = await Promise.all([
    readRlsStatus(),
    listSecurityPolicies(orgId),
    countIpAllowlist(orgId),
  ]);

  const covered = tables.filter(
    (t) => t.rls_enabled && t.isolation_policy
  ).length;

  const requireAllowlist = policies.find(
    (p) => p.kind === ("require_ip_allowlist" as SecurityPolicyKind)
  );

  return {
    rls: {
      tables,
      covered,
      total: tables.length,
      fully_isolated: covered === tables.length,
    },
    policies: {
      total: policies.length,
      enabled: policies.filter((p) => p.enabled).length,
      by_kind: policies.map((p) => ({ kind: p.kind, enabled: p.enabled })),
    },
    ip_allowlist: {
      count: allowlistCount,
      enforced: Boolean(requireAllowlist?.enabled) && allowlistCount > 0,
    },
  };
}

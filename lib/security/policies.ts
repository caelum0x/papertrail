import { getPool } from "@/lib/db";
import {
  SECURITY_POLICY_KINDS,
  type SecurityPolicy,
  type SecurityPolicyKind,
} from "@/lib/security/types";

// Repository for per-org security policies. All queries are org-scoped; the
// module never reads or writes another org's rows.

interface PolicyRow {
  id: string;
  org_id: string;
  kind: string;
  config: unknown;
  enabled: boolean;
  created_at: string | Date;
}

function toPolicy(row: PolicyRow): SecurityPolicy {
  return {
    id: row.id,
    org_id: row.org_id,
    kind: row.kind as SecurityPolicyKind,
    config:
      row.config && typeof row.config === "object"
        ? (row.config as Record<string, unknown>)
        : {},
    enabled: row.enabled,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  };
}

// Lists the org's stored policies (only kinds that have a row). Callers that
// want every known kind (including unconfigured ones) should use
// listPoliciesWithDefaults.
export async function listSecurityPolicies(
  orgId: string
): Promise<SecurityPolicy[]> {
  const { rows } = await getPool().query<PolicyRow>(
    `select id, org_id, kind, config, enabled, created_at
       from security_policies
      where org_id = $1
      order by created_at asc`,
    [orgId]
  );
  return rows.map(toPolicy);
}

// Every known policy kind, using the stored row when present or a disabled,
// empty-config default otherwise. This gives the editor a stable, complete list
// without pre-seeding rows for orgs that never configured a control.
export async function listPoliciesWithDefaults(
  orgId: string
): Promise<SecurityPolicy[]> {
  const stored = await listSecurityPolicies(orgId);
  const byKind = new Map(stored.map((p) => [p.kind, p]));
  return SECURITY_POLICY_KINDS.map((kind) => {
    const existing = byKind.get(kind);
    if (existing) return existing;
    return {
      id: `default:${kind}`,
      org_id: orgId,
      kind,
      config: {},
      enabled: false,
      created_at: new Date(0).toISOString(),
    } satisfies SecurityPolicy;
  });
}

export interface UpsertPolicyInput {
  orgId: string;
  kind: SecurityPolicyKind;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

// Creates or updates a policy for (org, kind). Only the provided fields change;
// omitted fields keep their existing value (or the column default on insert).
export async function upsertSecurityPolicy(
  input: UpsertPolicyInput
): Promise<SecurityPolicy> {
  // On insert: use provided values or safe defaults (enabled=true, config={}).
  // On conflict: only overwrite a column when the caller actually supplied it —
  // NULL params fall through to the existing row via coalesce.
  const insertEnabled = input.enabled ?? true;
  const insertConfig = JSON.stringify(input.config ?? {});
  const patchEnabled = input.enabled ?? null;
  const patchConfig =
    input.config === undefined ? null : JSON.stringify(input.config);

  const { rows } = await getPool().query<PolicyRow>(
    `insert into security_policies (org_id, kind, config, enabled)
       values ($1, $2, $3::jsonb, $4)
     on conflict (org_id, kind) do update
       set config = coalesce($5::jsonb, security_policies.config),
           enabled = coalesce($6, security_policies.enabled)
     returning id, org_id, kind, config, enabled, created_at`,
    [input.orgId, input.kind, insertConfig, insertEnabled, patchConfig, patchEnabled]
  );
  return toPolicy(rows[0]);
}

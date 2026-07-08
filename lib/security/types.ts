// Shared types for the Security & data isolation module (security policies, IP
// allowlist, RLS status). Kept dependency-free so both server repositories and
// client components can import the shapes.

// The set of security controls an org can configure. Each maps to a row in
// security_policies keyed by (org_id, kind). Adding a kind here + a config
// schema in schemas.ts is all that's needed to surface a new control.
export const SECURITY_POLICY_KINDS = [
  "require_ip_allowlist",
  "session_timeout",
  "mfa_required",
  "data_residency",
] as const;

export type SecurityPolicyKind = (typeof SECURITY_POLICY_KINDS)[number];

export interface SecurityPolicy {
  id: string;
  org_id: string;
  kind: SecurityPolicyKind;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface IpAllowlistEntry {
  id: string;
  org_id: string;
  cidr: string;
  note: string | null;
  created_at: string;
}

// Per-table RLS state as reported by the database catalog (pg_class /
// pg_policies). `rls_enabled` is the table-level toggle; `policy_count` is how
// many policies are attached; `isolation_policy` is true when our named
// org-isolation policy is present.
export interface RlsTableStatus {
  table: string;
  rls_enabled: boolean;
  policy_count: number;
  isolation_policy: boolean;
}

// Aggregate security posture for the org's status page: RLS coverage across the
// core tenant tables plus a summary of configured policies and allowlist size.
export interface SecurityStatus {
  rls: {
    tables: RlsTableStatus[];
    covered: number;
    total: number;
    fully_isolated: boolean;
  };
  policies: {
    total: number;
    enabled: number;
    by_kind: { kind: SecurityPolicyKind; enabled: boolean }[];
  };
  ip_allowlist: {
    count: number;
    enforced: boolean;
  };
}

// Human-readable metadata for each policy kind, shared by server + client so
// labels/descriptions stay consistent.
export interface PolicyKindMeta {
  kind: SecurityPolicyKind;
  label: string;
  description: string;
}

export const POLICY_KIND_META: Record<SecurityPolicyKind, PolicyKindMeta> = {
  require_ip_allowlist: {
    kind: "require_ip_allowlist",
    label: "Require IP allowlist",
    description:
      "Only allow access from the CIDR ranges configured under Access control.",
  },
  session_timeout: {
    kind: "session_timeout",
    label: "Session timeout",
    description:
      "Automatically sign members out after a period of inactivity.",
  },
  mfa_required: {
    kind: "mfa_required",
    label: "Require MFA",
    description:
      "Require multi-factor authentication for every member of this organization.",
  },
  data_residency: {
    kind: "data_residency",
    label: "Data residency",
    description:
      "Pin this organization's data and processing to a chosen region.",
  },
};

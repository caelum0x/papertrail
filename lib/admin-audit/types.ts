// Shared types for the admin console module (audit log, API keys, usage).
// Every entity is org-scoped; these are the JSON shapes returned by the module's
// /api routes and consumed by its console pages.

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// Distinct values available for the audit filter dropdowns, scoped to the org.
export interface AuditFilterOptions {
  actions: string[];
  entityTypes: string[];
  users: { id: string; name: string | null; email: string }[];
}

// An API key as shown in listings — never includes the raw secret.
export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string | null;
  createdByName: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

// Returned exactly once, at creation time. `key` is the full secret and is never
// stored or retrievable again.
export interface ApiKeyCreated extends ApiKeySummary {
  key: string;
}

// Aggregate usage counts for the current org.
export interface UsageMetrics {
  claims: number;
  verifications: number;
  documents: number;
  members: number;
  apiKeys: number;
  auditEvents: number;
  claimsByStatus: { status: string; count: number }[];
  verificationsByOutcome: { outcome: string; count: number }[];
}

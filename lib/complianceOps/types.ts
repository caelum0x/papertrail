import { z } from "zod";

// Shared, dependency-light shapes for the compliance-OPS layer: the operational
// side of the compliance controls (retention purge, chain integrity, access
// review). Kept in one place so both server repositories and client console
// components import the same validated shapes.
//
// INVARIANT: nothing here carries claim text, patient text, or secrets — only
// ids, counts, coarse statuses, and short non-sensitive reasons. Zod schemas
// bound the trust boundary in both directions (rows read from the db, payloads
// returned to the console).

export const CONTROL_KINDS = [
  "retention_purge",
  "chain_integrity",
  "access_review",
] as const;

export type ControlKind = (typeof CONTROL_KINDS)[number];

export const RUN_STATUSES = ["ok", "failed", "partial"] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

// A single recorded control run. `detail` is deliberately opaque JSON (counts /
// ids only, enforced by the writers) so the ledger stays counts-only.
export const controlRunSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  control: z.enum(CONTROL_KINDS),
  status: z.enum(RUN_STATUSES),
  reason: z.string().nullable(),
  detail: z.record(z.unknown()),
  createdAt: z.string(),
});

export type ControlRun = z.infer<typeof controlRunSchema>;

// ---- Retention purge -------------------------------------------------------

// Per-entity-type purge outcome. `action` records HOW the rows past retention
// were treated: hard-deleted, or anonymized in place (text nulled, row kept for
// the audit trail). `skipped` marks an entity_type with no known target table.
export const purgeItemSchema = z.object({
  entityType: z.string(),
  action: z.enum(["delete", "anonymize", "skipped"]),
  affected: z.number().int().nonnegative(),
  retainDays: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

export type PurgeItem = z.infer<typeof purgeItemSchema>;

// The full result of enforcing one org's retention policies.
export const purgeResultSchema = z.object({
  orgId: z.string().uuid(),
  policies: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  anonymized: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  items: z.array(purgeItemSchema),
  ranAt: z.string(),
});

export type PurgeResult = z.infer<typeof purgeResultSchema>;

// ---- Chain integrity -------------------------------------------------------

// One org's nightly chain-integrity result. Mirrors ChainVerification but adds
// the org id and never throws — a broken chain is DATA, not an exception.
export const chainIntegrityResultSchema = z.object({
  orgId: z.string().uuid(),
  ok: z.boolean(),
  length: z.number().int().nonnegative(),
  brokenAtSeq: z.number().int().nullable(),
  reason: z.string().nullable(),
  // Set when verification itself errored (db failure), distinct from a chain
  // that verified successfully-but-broken.
  errored: z.boolean(),
});

export type ChainIntegrityResult = z.infer<typeof chainIntegrityResultSchema>;

// ---- Access review ---------------------------------------------------------

// A base-role grant: a member's coarse org role (owner/admin/editor/viewer).
export const roleGrantSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.string(),
  grantedAt: z.string(),
});

export type RoleGrant = z.infer<typeof roleGrantSchema>;

// A fine-grained explicit permission grant (from permission_grants): a subject
// (user / team / role) bound to a resource+action pair.
export const permissionGrantSchema = z.object({
  id: z.string().uuid(),
  subjectType: z.enum(["user", "team", "role"]),
  subjectId: z.string().uuid(),
  resource: z.string(),
  action: z.string(),
  grantedAt: z.string(),
});

export type PermissionGrant = z.infer<typeof permissionGrantSchema>;

// A named custom role bundle (from custom_roles): a set of "resource:action"
// permission strings an org has defined.
export const customRoleSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  permissions: z.array(z.string()),
  grantedAt: z.string(),
});

export type CustomRoleSummary = z.infer<typeof customRoleSummarySchema>;

// The full access-review snapshot for one org: every role and permission grant
// as of `generatedAt`, ready for a periodic (e.g. quarterly) access review and
// downloadable as a self-describing JSON artifact.
export const accessReviewSnapshotSchema = z.object({
  orgId: z.string().uuid(),
  generatedAt: z.string(),
  roleGrants: z.array(roleGrantSchema),
  permissionGrants: z.array(permissionGrantSchema),
  customRoles: z.array(customRoleSummarySchema),
  counts: z.object({
    members: z.number().int().nonnegative(),
    permissionGrants: z.number().int().nonnegative(),
    customRoles: z.number().int().nonnegative(),
    admins: z.number().int().nonnegative(),
    owners: z.number().int().nonnegative(),
  }),
});

export type AccessReviewSnapshot = z.infer<typeof accessReviewSnapshotSchema>;

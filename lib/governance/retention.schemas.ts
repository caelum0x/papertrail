import { z } from "zod";

// Zod schemas for the DATA-RETENTION governance layer. These bound the trust
// boundary in two directions:
//   1. Validate the public PUT body a client sends to set an org's policy.
//   2. Describe the deterministic shapes the retention module returns, so a
//      malformed row can never masquerade as a policy or an export bundle.
//
// A retention window is a POSITIVE integer number of days, or null meaning
// "keep forever" (no automatic deletion for that data class). We reject zero and
// negatives explicitly so a client can never request an immediate mass purge via
// a degenerate window; an org that wants everything gone uses the export +
// explicit deletion path, not a 0-day policy.

const retentionDays = z
  .number()
  .int("Retention window must be a whole number of days.")
  .positive("Retention window must be at least 1 day.")
  .max(36500, "Retention window must be 36500 days (100 years) or fewer.")
  .nullable();

// The public PUT body. Every field is optional; an omitted field leaves that
// data class's window unchanged. An explicit null clears the window (keep
// forever). We refine to require at least one field so an empty PUT is rejected
// rather than silently no-op'ing.
export const setRetentionPolicySchema = z
  .object({
    evidenceReportsDays: retentionDays.optional(),
    engineUsageDays: retentionDays.optional(),
    auditDays: retentionDays.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.evidenceReportsDays !== undefined ||
      v.engineUsageDays !== undefined ||
      v.auditDays !== undefined,
    { message: "Provide at least one retention window to update." }
  );

export type SetRetentionPolicyInput = z.infer<typeof setRetentionPolicySchema>;

// The resolved policy shape returned by getPolicy/setPolicy. orgId is always the
// resolved server-side org; never a client value.
export const retentionPolicySchema = z.object({
  orgId: z.string().uuid(),
  evidenceReportsDays: z.number().int().positive().nullable(),
  engineUsageDays: z.number().int().positive().nullable(),
  auditDays: z.number().int().positive().nullable(),
  updatedAt: z.string(),
});

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

// The result of applyRetention: how many rows were purged from each data class.
export const retentionResultSchema = z.object({
  orgId: z.string().uuid(),
  evidenceReportsDeleted: z.number().int().nonnegative(),
  engineUsageDeleted: z.number().int().nonnegative(),
  appliedAt: z.string(),
});

export type RetentionResult = z.infer<typeof retentionResultSchema>;

// A single evidence-report artifact inside the DSAR export bundle. Kept loose on
// the JSON payload (report/pooled are engine-produced) but strict on identity
// and provenance fields so the bundle is self-describing.
export const exportedEvidenceReportSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  createdBy: z.string().uuid().nullable(),
  claim: z.string(),
  verdict: z.string().nullable(),
  certainty: z.string().nullable(),
  pooled: z.unknown().nullable(),
  report: z.unknown(),
  createdAt: z.string(),
});

export type ExportedEvidenceReport = z.infer<typeof exportedEvidenceReportSchema>;

// A single metered usage row inside the export bundle.
export const exportedEngineUsageSchema = z.object({
  id: z.string().uuid(),
  engine: z.string(),
  units: z.number().int(),
  claudeTokens: z.number().int(),
  occurredAt: z.string(),
});

export type ExportedEngineUsage = z.infer<typeof exportedEngineUsageSchema>;

// The full data-subject / portability export bundle for one org. Everything is
// org-scoped: the bundle contains ONLY the requesting org's artifacts.
export const evidenceExportBundleSchema = z.object({
  orgId: z.string().uuid(),
  exportedAt: z.string(),
  policy: retentionPolicySchema.nullable(),
  evidenceReports: z.array(exportedEvidenceReportSchema),
  engineUsage: z.array(exportedEngineUsageSchema),
  counts: z.object({
    evidenceReports: z.number().int().nonnegative(),
    engineUsage: z.number().int().nonnegative(),
  }),
});

export type EvidenceExportBundle = z.infer<typeof evidenceExportBundleSchema>;

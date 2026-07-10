import { z } from "zod";

// Boundary schemas for the tamper-evident evidence audit chain. The APPEND input
// is validated before it is folded into a hash: a chain is only as trustworthy
// as the shape of what goes into it, so we never hash unvalidated data.

// An evidence action verb. Kept as a constrained string rather than a closed
// enum so new evidence actions can be logged without a migration, but bounded so
// junk (empty strings, essays) can't enter the chain.
export const evidenceActionSchema = z
  .string()
  .trim()
  .min(1, "action is required")
  .max(120, "action is too long");

// The append payload. `entityId` is optional (some actions concern the org as a
// whole); `actor` is optional (system/automated actions have no user). `payload`
// is an arbitrary JSON object — the caller's structured record of the action —
// but must be an object so canonicalization is deterministic.
export const appendEvidenceAuditSchema = z.object({
  action: evidenceActionSchema,
  entityType: z.string().trim().min(1, "entityType is required").max(120),
  entityId: z.string().trim().min(1).max(400).nullable().optional(),
  actor: z.string().uuid("actor must be a uuid").nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type AppendEvidenceAuditInput = z.infer<typeof appendEvidenceAuditSchema>;

// Query params for reading a chain page.
export const listEvidenceAuditSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

export type ListEvidenceAuditInput = z.infer<typeof listEvidenceAuditSchema>;

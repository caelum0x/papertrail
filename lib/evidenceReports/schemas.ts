// Zod validation for the evidence-reports persistence boundary. This layer does
// NOT recompute the science — the engine (lib/evidenceReport.ts) already produced
// the composite object. Here we only validate that the client submitted a
// well-formed record to store: a claim, an object `report`, and optional
// denormalized summary fields. Never trust raw JSON from the request body.

import { z } from "zod";

// The composite report is an opaque object at this layer. We require it to be a
// plain object (not a string/array/number) but do not assert its internal shape —
// that is the engine's contract, validated where the report is computed.
const reportObjectSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => v !== null && !Array.isArray(v), {
    message: "report must be an object.",
  });

// POST /api/evidence-reports body. Stores a claim + the composite report object
// the caller already computed. org_id is NEVER accepted here — it always comes
// from the authenticated context (ctx.org.id).
export const createEvidenceReportSchema = z.object({
  claim: z.string().trim().min(1).max(4000),
  report: reportObjectSchema,
  // Optional denormalized summary fields. If omitted, the caller may still store
  // the report; lists simply show null for these columns.
  verdict: z.string().trim().min(1).max(200).optional(),
  certainty: z.string().trim().min(1).max(200).optional(),
  pooled: reportObjectSchema.optional(),
  // Soft reference to an owning project. Not FK-enforced at the DB layer.
  projectId: z.string().uuid().optional(),
});

export type CreateEvidenceReportBody = z.infer<typeof createEvidenceReportSchema>;

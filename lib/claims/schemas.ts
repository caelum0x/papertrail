import { z } from "zod";

// Zod schemas for the claims module. All external input (request bodies, query
// params) is validated against these before it reaches the SQL layer — never trust
// raw JSON from a client.

// The lifecycle states a claim can be in. Kept in sync with the CHECK constraint
// in db/migrations/0004_claims.sql.
export const CLAIM_STATUSES = [
  "draft",
  "submitted",
  "verifying",
  "verified",
  "flagged",
  "archived",
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const claimStatusSchema = z.enum(CLAIM_STATUSES);

// Body for POST /api/claims. project_id and cited_source_url are optional.
export const createClaimSchema = z.object({
  text: z.string().trim().min(1, "Claim text is required.").max(5000),
  project_id: z.string().uuid().nullable().optional(),
  cited_source_url: z.string().url().max(2000).nullable().optional(),
  status: claimStatusSchema.optional(),
});

export type CreateClaimInput = z.infer<typeof createClaimSchema>;

// Body for PATCH /api/claims/[id]. Every field optional; at least one required.
export const updateClaimSchema = z
  .object({
    text: z.string().trim().min(1).max(5000).optional(),
    project_id: z.string().uuid().nullable().optional(),
    cited_source_url: z.string().url().max(2000).nullable().optional(),
    status: claimStatusSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided.",
  });

export type UpdateClaimInput = z.infer<typeof updateClaimSchema>;

// Validated list filters parsed from query params.
export const listClaimsFilterSchema = z.object({
  project_id: z.string().uuid().optional(),
  status: claimStatusSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
});

export type ListClaimsFilter = z.infer<typeof listClaimsFilterSchema>;

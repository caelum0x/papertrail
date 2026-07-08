import { z } from "zod";

// Boundary validation for the publication-planning APIs. Never trust request
// bodies or query strings — parse them through these schemas before use.

export const PUBLICATION_TYPES = [
  "manuscript",
  "abstract",
  "poster",
  "slide_deck",
  "other",
] as const;

export const PUBLICATION_STATUSES = [
  "planning",
  "in_review",
  "approved",
  "published",
  "archived",
] as const;

export const PUBLICATION_STAGES = [
  "concept",
  "outline",
  "first_draft",
  "internal_review",
  "mlr_review",
  "final",
] as const;

export const MLR_ROLES = [
  "medical",
  "legal",
  "regulatory",
  "editorial",
] as const;

export const MLR_DECISIONS = [
  "approved",
  "rejected",
  "changes_requested",
] as const;

// Body for POST /api/publications — start planning a new publication.
export const createPublicationSchema = z.object({
  title: z.string().trim().min(1, "A title is required.").max(500),
  type: z.enum(PUBLICATION_TYPES).default("manuscript"),
  targetJournal: z.string().trim().min(1).max(300).nullish(),
  projectId: z.string().uuid().nullish(),
});

export type CreatePublicationInput = z.infer<typeof createPublicationSchema>;

// Body for PATCH /api/publications/[id] — edit metadata / advance status & stage.
export const updatePublicationSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    type: z.enum(PUBLICATION_TYPES).optional(),
    targetJournal: z.string().trim().max(300).nullish(),
    status: z.enum(PUBLICATION_STATUSES).optional(),
    stage: z.enum(PUBLICATION_STAGES).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "No fields to update.",
  });

export type UpdatePublicationInput = z.infer<typeof updatePublicationSchema>;

// Body for POST /api/publications/[id]/claims — attach one or many verified claims.
export const attachClaimsSchema = z.object({
  claimIds: z
    .array(z.string().uuid())
    .min(1, "Provide at least one claim to attach.")
    .max(200, "Attach at most 200 claims at a time."),
});

export type AttachClaimsInput = z.infer<typeof attachClaimsSchema>;

// Body for POST /api/publications/[id]/mlr — submit an MLR review decision.
export const mlrReviewSchema = z.object({
  role: z.enum(MLR_ROLES),
  decision: z.enum(MLR_DECISIONS),
  comments: z.string().trim().max(5000).nullish(),
});

export type MlrReviewInput = z.infer<typeof mlrReviewSchema>;

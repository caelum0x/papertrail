import { z } from "zod";

// Boundary validation for the review-workflow APIs. Never trust request bodies
// or query strings — parse them through these schemas before use.

export const REVIEW_STATUSES = [
  "pending",
  "in_review",
  "approved",
  "rejected",
  "cancelled",
] as const;

export const REVIEW_DECISIONS = ["approved", "rejected"] as const;

// Body for POST /api/reviews — create/assign a review. At least one of
// projectId / claimId should identify what is being reviewed.
export const createReviewSchema = z
  .object({
    projectId: z.string().uuid().nullish(),
    claimId: z.string().uuid().nullish(),
    assigneeId: z.string().uuid().nullish(),
    comment: z.string().max(5000).nullish(),
    dueDate: z.string().datetime().nullish(),
  })
  .refine((v) => Boolean(v.projectId) || Boolean(v.claimId), {
    message: "A review must reference a projectId or claimId.",
  });

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

// Body for PATCH /api/reviews/[id] — reassign / edit metadata (not decisions).
export const updateReviewSchema = z
  .object({
    assigneeId: z.string().uuid().nullish(),
    status: z.enum(["pending", "in_review", "cancelled"]).optional(),
    comment: z.string().max(5000).nullish(),
    dueDate: z.string().datetime().nullish(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "No fields to update.",
  });

export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

// Body for POST /api/reviews/[id]/decision — approve/reject with comment.
export const decisionSchema = z.object({
  decision: z.enum(REVIEW_DECISIONS),
  comment: z.string().max(5000).nullish(),
});

export type DecisionInput = z.infer<typeof decisionSchema>;

// Query filters for GET /api/reviews.
export const queueQuerySchema = z.object({
  scope: z.enum(["mine", "all"]).default("all"),
  status: z.enum(REVIEW_STATUSES).optional(),
});

export type QueueQueryInput = z.infer<typeof queueQuerySchema>;

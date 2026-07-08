// Shared types for the review-workflow module. A review assigns a claim or
// verification (identified loosely by project_id / claim_id) to a reviewer for
// human approval. Editors create/submit reviews; admins render decisions.

export type ReviewStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "cancelled";

export type ReviewDecision = "approved" | "rejected";

export interface Review {
  id: string;
  orgId: string;
  projectId: string | null;
  claimId: string | null;
  assigneeId: string | null;
  reviewerId: string | null;
  status: ReviewStatus;
  decision: ReviewDecision | null;
  comment: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

// A review enriched with the names/emails of the people attached to it, for
// display in the queue and detail views.
export interface ReviewWithPeople extends Review {
  assigneeName: string | null;
  assigneeEmail: string | null;
  reviewerName: string | null;
  reviewerEmail: string | null;
}

export type ReviewScope = "mine" | "all";

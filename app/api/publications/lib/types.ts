// Shared types for the publication-planning & medical-writing module. A
// publication plans a manuscript/abstract/poster; verified claims are attached
// to it, and MLR (Medical/Legal/Regulatory) reviewers sign off before release.

export type PublicationType =
  | "manuscript"
  | "abstract"
  | "poster"
  | "slide_deck"
  | "other";

export type PublicationStatus =
  | "planning"
  | "in_review"
  | "approved"
  | "published"
  | "archived";

export type PublicationStage =
  | "concept"
  | "outline"
  | "first_draft"
  | "internal_review"
  | "mlr_review"
  | "final";

export type PublicationClaimStatus = "proposed" | "included" | "removed";

export type MlrRole = "medical" | "legal" | "regulatory" | "editorial";

export type MlrDecision = "approved" | "rejected" | "changes_requested";

export interface Publication {
  id: string;
  orgId: string;
  projectId: string | null;
  title: string;
  type: PublicationType;
  targetJournal: string | null;
  status: PublicationStatus;
  stage: PublicationStage;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// A publication enriched with attached-claim counts, for list and detail headers.
export interface PublicationWithCounts extends Publication {
  claimCount: number;
  verifiedCount: number;
}

// An attached claim, joined with the underlying claim's text, status and its
// latest verification outcome so the plan view can show verification state.
export interface PublicationClaim {
  id: string;
  orgId: string;
  publicationId: string;
  claimId: string;
  status: PublicationClaimStatus;
  createdAt: string;
  // Denormalized from the claims / verifications modules (may be null if the
  // claim was deleted out from under the attachment).
  claimText: string | null;
  claimStatus: string | null;
  discrepancyType: string | null;
  trustScore: number | null;
}

export interface MlrReview {
  id: string;
  orgId: string;
  publicationId: string;
  reviewerId: string | null;
  role: MlrRole;
  decision: MlrDecision;
  comments: string | null;
  createdAt: string;
}

// Readiness summary: how many attached claims are verified and accurate, plus
// the current MLR sign-off status per role.
export interface PublicationReadiness {
  totalClaims: number;
  includedClaims: number;
  verifiedClaims: number;
  accurateClaims: number;
  flaggedClaims: number;
  unverifiedClaims: number;
  // True when every included claim is verified & accurate and no role has
  // rejected or requested changes in its latest decision.
  ready: boolean;
  mlrStatus: { role: MlrRole; decision: MlrDecision | null }[];
}

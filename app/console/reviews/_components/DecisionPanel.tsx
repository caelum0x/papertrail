"use client";

import type { ReviewWithPeople } from "@/lib/reviews/types";

interface DecisionPanelProps {
  review: ReviewWithPeople;
  canApprove: boolean;
  comment: string;
  submitting: boolean;
  actionError: string | null;
  onCommentChange: (value: string) => void;
  onDecide: (decision: "approved" | "rejected") => void;
}

// Renders the correct decision affordance for the current role + review state:
// the approve/reject form, a decided banner, or a permission notice.
export function DecisionPanel({
  review,
  canApprove,
  comment,
  submitting,
  actionError,
  onCommentChange,
  onDecide,
}: DecisionPanelProps) {
  const isDecided =
    review.status === "approved" || review.status === "rejected";

  if (canApprove && !isDecided) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-6">
        <h2 className="text-sm font-medium text-ink/70">Decision</h2>
        <p className="mt-1 text-sm text-ink/40">
          Approve or reject this review. Your comment is recorded on the review
          and in the audit log.
        </p>
        <textarea
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          rows={3}
          placeholder="Optional comment explaining your decision..."
          className="mt-3 w-full rounded-md border border-ink/15 bg-white p-3 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
        {actionError ? (
          <p className="mt-2 text-sm text-red-700">{actionError}</p>
        ) : null}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onDecide("approved")}
            disabled={submitting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Approve"}
          </button>
          <button
            onClick={() => onDecide("rejected")}
            disabled={submitting}
            className="rounded-md border border-red-600/40 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      </div>
    );
  }

  if (isDecided) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-6 text-sm text-ink/60">
        This review was{" "}
        <span className="font-medium">
          {review.decision === "approved" ? "approved" : "rejected"}
        </span>
        {review.reviewerName || review.reviewerEmail
          ? ` by ${review.reviewerName ?? review.reviewerEmail}`
          : ""}
        .
      </div>
    );
  }

  if (!canApprove) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-6 text-sm text-ink/40">
        Only admins can approve or reject reviews.
      </div>
    );
  }

  return null;
}

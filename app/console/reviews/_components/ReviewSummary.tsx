import { StatusBadge } from "@/components/reviews/StatusBadge";
import type { ReviewStatus, ReviewWithPeople } from "@/lib/reviews/types";
import { formatDateTime } from "./format";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink/40">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink/80">{value}</dd>
    </div>
  );
}

interface ReviewSummaryProps {
  review: ReviewWithPeople;
}

// Read-only summary card for a single review: header, metadata grid, comment.
export function ReviewSummary({ review }: ReviewSummaryProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink/80">
            Review {review.id.slice(0, 8)}
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            {review.claimId
              ? `Claim ${review.claimId}`
              : review.projectId
              ? `Project ${review.projectId}`
              : "No reference"}
          </p>
        </div>
        <StatusBadge status={review.status as ReviewStatus} />
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Assignee"
          value={review.assigneeName ?? review.assigneeEmail ?? "Unassigned"}
        />
        <Field
          label="Reviewer"
          value={review.reviewerName ?? review.reviewerEmail ?? "—"}
        />
        <Field label="Due date" value={formatDateTime(review.dueDate)} />
        <Field label="Created" value={formatDateTime(review.createdAt)} />
        <Field
          label="Decision"
          value={
            review.decision
              ? review.decision === "approved"
                ? "Approved"
                : "Rejected"
              : "—"
          }
        />
        <Field label="Last updated" value={formatDateTime(review.updatedAt)} />
      </dl>

      {review.comment ? (
        <div className="mt-6 rounded-md border border-ink/10 bg-paper p-4">
          <div className="text-xs uppercase tracking-wide text-ink/40">
            Comment
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink/80">
            {review.comment}
          </p>
        </div>
      ) : null}
    </div>
  );
}

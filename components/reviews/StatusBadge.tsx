import type { ReviewStatus } from "@/lib/reviews/types";

// Small colored pill for a review status. Uses only the shared token palette.
interface StatusBadgeProps {
  status: ReviewStatus;
}

const LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STYLES: Record<ReviewStatus, string> = {
  pending: "bg-paper text-ink/60 border-ink/15",
  in_review: "bg-paper text-accent border-accent/30",
  approved: "bg-white text-green-700 border-green-600/30",
  rejected: "bg-white text-red-700 border-red-600/30",
  cancelled: "bg-white text-ink/40 border-ink/10",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}

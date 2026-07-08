import Link from "next/link";
import { StatusBadge } from "@/components/reviews/StatusBadge";
import type { ReviewStatus, ReviewWithPeople } from "@/lib/reviews/types";
import { formatDate, refLabel } from "./format";

interface ReviewRowProps {
  review: ReviewWithPeople;
}

function ReviewRow({ review }: ReviewRowProps) {
  return (
    <tr className="border-b border-ink/10 last:border-0 hover:bg-paper">
      <td className="px-4 py-3 text-ink/80">{refLabel(review)}</td>
      <td className="px-4 py-3">
        <StatusBadge status={review.status as ReviewStatus} />
      </td>
      <td className="px-4 py-3 text-ink/60">
        {review.assigneeName ?? review.assigneeEmail ?? "Unassigned"}
      </td>
      <td className="px-4 py-3 text-ink/60">{formatDate(review.dueDate)}</td>
      <td className="px-4 py-3 text-ink/60">{formatDate(review.createdAt)}</td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/console/reviews/${review.id}`}
          className="text-accent hover:underline"
        >
          Open
        </Link>
      </td>
    </tr>
  );
}

interface ReviewsTableProps {
  items: ReviewWithPeople[];
}

export function ReviewsTable({ items }: ReviewsTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Reference</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Assignee</th>
          <th className="px-4 py-2 font-medium">Due</th>
          <th className="px-4 py-2 font-medium">Created</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((r) => (
          <ReviewRow key={r.id} review={r} />
        ))}
      </tbody>
    </table>
  );
}

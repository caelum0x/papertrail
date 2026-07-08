import Link from "next/link";
import { StatusBadge } from "@/components/reviews/StatusBadge";
import type { ReviewStatus } from "@/lib/reviews/types";

export interface StatusCount {
  status: ReviewStatus;
  label: string;
  count: number;
}

interface StatusBreakdownProps {
  counts: StatusCount[];
  total: number;
}

// Read-only grid of per-status review counts. Each card links to the queue
// pre-filtered to that status via the existing ?status= behaviour is driven
// client-side, so we just deep-link back to the queue.
export function StatusBreakdown({ counts, total }: StatusBreakdownProps) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {counts.map((c) => (
          <div
            key={c.status}
            className="rounded-lg border border-ink/15 bg-white p-4"
          >
            <div className="flex items-center justify-between">
              <StatusBadge status={c.status} />
              <span className="text-2xl font-semibold tabular-nums text-ink/80">
                {c.count}
              </span>
            </div>
            <p className="mt-2 text-xs text-ink/40">
              {total > 0
                ? `${Math.round((c.count / total) * 100)}% of reviews`
                : "No reviews yet"}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 text-sm text-ink/60">
        <Link href="/console/reviews" className="text-accent hover:underline">
          Open the review queue →
        </Link>
      </div>
    </div>
  );
}

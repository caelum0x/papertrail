"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchReviews } from "@/components/reviews/reviewClient";
import type { ReviewStatus } from "@/lib/reviews/types";
import { ModuleHeader } from "../_components/ModuleHeader";
import { StateBlock } from "../_components/StateBlock";
import {
  StatusBreakdown,
  type StatusCount,
} from "../_components/StatusBreakdown";

// Status breakdown built entirely from the existing /api/reviews endpoint:
// one count-only query per status (limit 1, reading meta.total).
const STATUSES: { status: ReviewStatus; label: string }[] = [
  { status: "pending", label: "Pending" },
  { status: "in_review", label: "In review" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
  { status: "cancelled", label: "Cancelled" },
];

export default function ReviewsOverviewPage() {
  const [counts, setCounts] = useState<StatusCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        STATUSES.map(async (s) => {
          const res = await fetchReviews("all", s.status, 1, 1);
          if (res.error) throw new Error(res.error);
          return { status: s.status, label: s.label, count: res.total };
        })
      );
      setCounts(results);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load review overview."
      );
      setCounts([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const total = counts.reduce((sum, c) => sum + c.count, 0);

  return (
    <div>
      <Link href="/console/reviews" className="text-sm text-accent hover:underline">
        ← Back to reviews
      </Link>
      <div className="mt-2">
        <ModuleHeader
          title="Review overview"
          description="Distribution of reviews across the approval lifecycle for this org."
        />
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="rounded-lg border border-ink/15 bg-white">
            <StateBlock kind="loading" message="Loading overview…" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-ink/15 bg-white">
            <StateBlock kind="error" message={error} onRetry={load} />
          </div>
        ) : total === 0 ? (
          <div className="rounded-lg border border-ink/15 bg-white">
            <StateBlock kind="empty" message="No reviews yet." />
          </div>
        ) : (
          <StatusBreakdown counts={counts} total={total} />
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchPublication, fetchMlrReviews } from "../../client";
import type {
  MlrReview,
  PublicationWithCounts,
} from "@/app/api/publications/lib/types";
import { roleLabel, decisionLabel } from "../../_components/mlr";
import { TableCard, TableLoading, TableError } from "../../_components/TableCard";

// MLR activity sub-page: the full sign-off history for one publication,
// newest first, from the existing /api/publications/[id]/mlr endpoint.
export default function PublicationActivityPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [publication, setPublication] =
    useState<PublicationWithCounts | null>(null);
  const [reviews, setReviews] = useState<MlrReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [pub, revs] = await Promise.all([
      fetchPublication(id),
      fetchMlrReviews(id),
    ]);
    if (pub.data) setPublication(pub.data);
    if (revs.error) {
      setError(revs.error);
      setReviews([]);
    } else {
      setReviews(revs.data ?? []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const sorted = [...reviews].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div>
      <Link
        href={`/console/publications/${id}`}
        className="text-sm text-accent hover:underline"
      >
        ← Back to publication
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-ink/80">
        {publication ? `${publication.title} — MLR activity` : "MLR activity"}
      </h1>
      <p className="mt-1 text-sm text-ink/40">
        Chronological Medical / Legal / Regulatory sign-off history.
      </p>

      <div className="mt-6">
        <TableCard>
          {loading ? (
            <TableLoading>Loading activity...</TableLoading>
          ) : error ? (
            <TableError message={error} onRetry={load} />
          ) : sorted.length === 0 ? (
            <TableLoading>
              No MLR decisions recorded yet. Submit one from the publication page.
            </TableLoading>
          ) : (
            <ul className="divide-y divide-ink/10">
              {sorted.map((r) => (
                <li key={r.id} className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-ink/80">
                      {roleLabel(r.role)} — {decisionLabel(r.decision)}
                    </span>
                    <span className="text-xs text-ink/40">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {r.comments ? (
                    <p className="mt-1 text-sm text-ink/60">{r.comments}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </TableCard>
      </div>
    </div>
  );
}

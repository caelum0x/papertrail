"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchPublications } from "../client";
import type { PublicationWithCounts } from "@/app/api/publications/lib/types";
import { StatTile } from "../_components/StatTile";
import { statusLabel, typeLabel } from "../_components/labels";
import { TableCard, TableLoading, TableError } from "../_components/TableCard";

const OVERVIEW_LIMIT = 200;

// Portfolio overview sub-page: aggregate counts by status/type and a
// verification-coverage summary, all from the existing /api/publications list.
export default function PublicationsOverviewPage() {
  const [items, setItems] = useState<PublicationWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchPublications(1, OVERVIEW_LIMIT);
    if (result.error) {
      setError(result.error);
      setItems([]);
    } else {
      setItems(result.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totalClaims = items.reduce((sum, p) => sum + p.claimCount, 0);
  const verifiedClaims = items.reduce((sum, p) => sum + p.verifiedCount, 0);
  const coverage =
    totalClaims > 0 ? Math.round((verifiedClaims / totalClaims) * 100) : 0;

  const byStatus = items.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  const byType = items.reduce<Record<string, number>>((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <Link
        href="/console/publications"
        className="text-sm text-accent hover:underline"
      >
        ← Back to publications
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-ink/80">
        Portfolio overview
      </h1>
      <p className="mt-1 text-sm text-ink/40">
        Status mix and verification coverage across all publication plans.
      </p>

      <div className="mt-6">
        {loading ? (
          <TableCard>
            <TableLoading>Loading overview...</TableLoading>
          </TableCard>
        ) : error ? (
          <TableCard>
            <TableError message={error} onRetry={load} />
          </TableCard>
        ) : items.length === 0 ? (
          <TableCard>
            <TableLoading>
              No publications yet. Create one to populate this overview.
            </TableLoading>
          </TableCard>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile value={items.length} label="Publications" />
              <StatTile value={totalClaims} label="Attached claims" />
              <StatTile
                value={verifiedClaims}
                label="Verified claims"
                emphasis="green"
              />
              <StatTile
                value={`${coverage}%`}
                label="Verification coverage"
                emphasis={coverage >= 80 ? "green" : "amber"}
              />
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <h2 className="text-sm font-medium text-ink/70">By status</h2>
                <div className="mt-3 space-y-2">
                  {Object.entries(byStatus).map(([status, count]) => (
                    <div
                      key={status}
                      className="flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
                    >
                      <span className="text-ink/70">{statusLabel(status)}</span>
                      <span className="text-ink/50">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="text-sm font-medium text-ink/70">By type</h2>
                <div className="mt-3 space-y-2">
                  {Object.entries(byType).map(([type, count]) => (
                    <div
                      key={type}
                      className="flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2 text-sm"
                    >
                      <span className="text-ink/70">{typeLabel(type)}</span>
                      <span className="text-ink/50">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

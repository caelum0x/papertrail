"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { EvidenceItem, EvidenceSourceType } from "@/lib/evidence/types";
import { fetchEvidenceList } from "@/components/evidence/api";
import { SOURCE_TYPE_OPTIONS } from "@/components/evidence/labels";
import { SourceTypeBadge, TagBadge } from "@/components/evidence/EvidenceBadges";

// Library overview: source-type breakdown and most common tags, computed from a
// sampled page of the existing evidence list endpoint.
const OVERVIEW_LIMIT = 100;
const TOP_TAGS = 12;

export default function EvidenceOverviewPage() {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchEvidenceList({ page: 1, limit: OVERVIEW_LIMIT });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const typeCounts = useMemo(() => {
    const counts: Record<EvidenceSourceType, number> = {
      pubmed: 0,
      clinicaltrials: 0,
      document: 0,
      other: 0,
    };
    for (const item of items) counts[item.source_type] += 1;
    return counts;
  }, [items]);

  const topTags = useMemo(() => {
    const freq = new Map<string, number>();
    for (const item of items) {
      for (const tag of item.tags) {
        freq.set(tag, (freq.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_TAGS);
  }, [items]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">Library overview</h1>
          <p className="mt-1 text-sm text-ink/40">
            Source-type breakdown and common tags across your evidence.
          </p>
        </div>
        <Link
          href="/console/evidence"
          className="rounded-md border border-ink/15 px-3 py-2 text-sm text-ink/70 hover:border-accent"
        >
          Back to library
        </Link>
      </div>

      {loading ? (
        <div className="mt-6 bg-white border border-ink/15 rounded-lg p-8 text-center text-sm text-ink/40">
          Loading overview...
        </div>
      ) : error ? (
        <div className="mt-6 bg-white border border-red-200 rounded-lg p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
            <h2 className="text-sm font-medium text-ink/70">
              By source type{" "}
              <span className="text-ink/35">({total} total)</span>
            </h2>
            <ul className="mt-3 divide-y divide-ink/10">
              {SOURCE_TYPE_OPTIONS.map((o) => (
                <li
                  key={o.value}
                  className="py-2 flex items-center justify-between text-sm"
                >
                  <SourceTypeBadge type={o.value} />
                  <span className="text-ink/70">{typeCounts[o.value]}</span>
                </li>
              ))}
            </ul>
            {total > items.length ? (
              <p className="mt-3 text-xs text-ink/35">
                Counts reflect the first {items.length} of {total} items.
              </p>
            ) : null}
          </div>

          <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
            <h2 className="text-sm font-medium text-ink/70">Common tags</h2>
            {topTags.length === 0 ? (
              <p className="mt-2 text-sm text-ink/40">No tags yet.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {topTags.map(([tag, count]) => (
                  <span key={tag} className="inline-flex items-center gap-1">
                    <TagBadge tag={tag} />
                    <span className="text-xs text-ink/40">×{count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

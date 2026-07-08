"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchTagUsage,
  type TagUsageDto,
} from "@/components/tags/api";

// Side panel showing where a tag is attached: a per-entity-type breakdown plus a
// recent list of individual taggings. Owns its own loading/empty/error states.

interface TagUsageListProps {
  tagId: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export default function TagUsageList({ tagId }: TagUsageListProps) {
  const [usage, setUsage] = useState<TagUsageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchTagUsage(tagId, 25);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load usage.");
      setLoading(false);
      return;
    }
    setUsage(res.data);
    setLoading(false);
  }, [tagId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink/80">Usage</h2>

      {loading ? (
        <p className="mt-3 text-sm text-ink/40">Loading usage…</p>
      ) : error ? (
        <div className="mt-3">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-1 text-sm text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      ) : !usage || usage.total === 0 ? (
        <p className="mt-3 text-sm text-ink/40">
          This tag isn&apos;t attached to anything yet.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink/40">
              By entity type
            </p>
            <ul className="mt-2 space-y-1">
              {usage.groups.map((g) => (
                <li
                  key={g.entityType}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="capitalize text-ink/80">{g.entityType}</span>
                  <span className="text-ink/60">{g.count}</span>
                </li>
              ))}
              <li className="flex items-center justify-between border-t border-ink/10 pt-1 text-sm font-medium">
                <span className="text-ink/80">Total</span>
                <span className="text-ink/80">{usage.total}</span>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-ink/40">Recent</p>
            <ul className="mt-2 space-y-1">
              {usage.taggings.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between text-xs text-ink/60"
                >
                  <span>
                    <span className="capitalize text-ink/80">{t.entityType}</span>{" "}
                    <span className="font-mono">{t.entityId.slice(0, 8)}</span>
                  </span>
                  <span>{formatDate(t.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchFlagAudit,
  type FlagAuditEntry,
} from "@/components/flags/api";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  relativeTime,
} from "@/components/flags/ui";

// Recent change history for a flag, read from the org audit log. `refreshKey`
// lets the parent force a reload after it saves a change.
const ACTION_LABELS: Record<string, string> = {
  "feature_flag.created": "Created",
  "feature_flag.updated": "Updated",
  "feature_flag.deleted": "Deleted",
};

export function FlagAudit({
  flagId,
  refreshKey = 0,
}: {
  flagId: string;
  refreshKey?: number;
}) {
  const [entries, setEntries] = useState<FlagAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchFlagAudit(flagId);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load history.");
      setLoading(false);
      return;
    }
    setEntries(res.data);
    setLoading(false);
  }, [flagId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">History</h2>
      <div className="mt-3">
        {loading ? (
          <LoadingState label="Loading history…" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : entries.length === 0 ? (
          <EmptyState title="No recorded changes yet." />
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-start justify-between gap-3 border-b border-ink/5 pb-2 text-sm last:border-0"
              >
                <div>
                  <span className="font-medium text-ink/80">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                  {typeof entry.metadata.rolloutPercent === "number" && (
                    <span className="ml-2 text-xs text-ink/50">
                      rollout {String(entry.metadata.rolloutPercent)}%
                    </span>
                  )}
                  {typeof entry.metadata.enabled === "boolean" && (
                    <span className="ml-2 text-xs text-ink/50">
                      {entry.metadata.enabled ? "enabled" : "disabled"}
                    </span>
                  )}
                </div>
                <span className="whitespace-nowrap text-[11px] text-ink/40">
                  {relativeTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

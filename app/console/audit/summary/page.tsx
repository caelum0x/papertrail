"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { AuditNoAccess } from "../_components/AuditNoAccess";
import { AuditBreakdown } from "../_components/AuditBreakdown";
import type { AuditListResponse, AuditLogEntry } from "../_components/types";

// How many recent entries to summarize. Uses only the existing /api/audit
// endpoint (a single large page) and aggregates client-side.
const SAMPLE_SIZE = 200;

function countBy(
  entries: AuditLogEntry[],
  key: (e: AuditLogEntry) => string
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const label = key(entry);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

// Audit summary sub-page: an at-a-glance breakdown of recent audit activity by
// action, entity type, and actor. Read-only aggregation over /api/audit.
export default function AuditSummaryPage() {
  const { canManage, loading: roleLoading } = useCurrentRole();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<AuditListResponse>(
      `/api/audit?page=1&limit=${SAMPLE_SIZE}`
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load audit summary.");
      setLoading(false);
      return;
    }
    setEntries(res.data.entries);
    setTotal(res.meta?.total ?? res.data.entries.length);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!roleLoading && canManage) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, canManage, load]);

  const byAction = useMemo(
    () => countBy(entries, (e) => e.action),
    [entries]
  );
  const byEntity = useMemo(
    () => countBy(entries, (e) => e.entityType),
    [entries]
  );
  const byActor = useMemo(
    () =>
      countBy(entries, (e) => e.userName ?? e.userEmail ?? "System").slice(0, 8),
    [entries]
  );

  if (!roleLoading && !canManage) {
    return <AuditNoAccess title="Audit summary" />;
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">Audit summary</h1>
          <p className="mt-1 text-sm text-ink/40">
            Breakdown of the {Math.min(entries.length, SAMPLE_SIZE)} most recent
            events{total > entries.length ? ` of ${total.toLocaleString()}` : ""}.
          </p>
        </div>
        <Link
          href="/console/audit"
          className="text-sm text-accent hover:underline shrink-0"
        >
          ← Full log
        </Link>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading summary...</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : entries.length === 0 ? (
        <p className="mt-6 text-sm text-ink/40">No audit events recorded yet.</p>
      ) : (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <AuditBreakdown title="Events by action" rows={byAction} />
          <AuditBreakdown title="Events by entity type" rows={byEntity} />
          <AuditBreakdown title="Most active people" rows={byActor} />
        </div>
      )}
    </div>
  );
}

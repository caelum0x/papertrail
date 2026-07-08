"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { AdminNoAccess } from "../_components/AdminNoAccess";
import {
  RecentActivityList,
  type RecentActivityEntry,
} from "../_components/RecentActivityList";

interface AuditListResponse {
  entries: RecentActivityEntry[];
  filters: unknown;
}

const LIMIT = 30;

// Admin recent-activity sub-page: the most recent audit-trail actions, drawn
// from the existing /api/audit endpoint. A lighter view than the full log.
export default function AdminActivityPage() {
  const { canManage, loading: roleLoading } = useCurrentRole();
  const [entries, setEntries] = useState<RecentActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<AuditListResponse>(
      `/api/audit?page=1&limit=${LIMIT}`
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load activity.");
      setLoading(false);
      return;
    }
    setEntries(res.data.entries);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!roleLoading && canManage) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, canManage, load]);

  if (!roleLoading && !canManage) {
    return (
      <AdminNoAccess
        title="Recent activity"
        message="You need an admin or owner role to view recent activity."
      />
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">
            Recent activity
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            The {LIMIT} most recent actions across this organization.
          </p>
        </div>
        <Link
          href="/console/audit"
          className="text-sm text-accent hover:underline shrink-0"
        >
          Full audit log
        </Link>
      </div>

      <RecentActivityList entries={entries} loading={loading} error={error} />
    </div>
  );
}

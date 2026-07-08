"use client";

import { useCallback, useEffect, useState } from "react";
import type { SecurityStatus } from "@/lib/security/types";
import { fetchSecurityStatus } from "./api";
import { LoadingState, ErrorState } from "./StateViews";
import { StatCard } from "./StatCard";
import { RlsTable } from "./RlsTable";

// Overview panel for the Security Center landing page: a summary metric row plus
// the per-table RLS breakdown. Owns its own data fetch + loading/error states.

export function SecurityOverview() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSecurityStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Loading security status…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!status) return null;

  const rlsTone = status.rls.fully_isolated ? "good" : "warn";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Tenant isolation"
          value={`${status.rls.covered}/${status.rls.total}`}
          hint={
            status.rls.fully_isolated
              ? "All core tables enforce row-level security"
              : "Some tables are not yet isolated"
          }
          tone={rlsTone}
        />
        <StatCard
          label="Active policies"
          value={`${status.policies.enabled}`}
          hint={`${status.policies.total} configured`}
        />
        <StatCard
          label="IP allowlist"
          value={`${status.ip_allowlist.count}`}
          hint={
            status.ip_allowlist.enforced
              ? "Enforced for all access"
              : "Not enforced"
          }
          tone={status.ip_allowlist.enforced ? "good" : "default"}
        />
      </div>

      <div>
        <h2 className="text-sm font-medium text-ink/70">
          Row-level security by table
        </h2>
        <p className="mt-1 text-sm text-ink/40">
          Each core tenant table enforces org isolation at the database level, so
          a query can never return another organization&apos;s rows.
        </p>
        <div className="mt-3">
          <RlsTable tables={status.rls.tables} />
        </div>
      </div>
    </div>
  );
}

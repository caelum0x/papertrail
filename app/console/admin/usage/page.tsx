"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { AdminNoAccess } from "../_components/AdminNoAccess";
import { MetricCards } from "../_components/MetricCards";
import { UsageBreakdown } from "../_components/UsageBreakdown";

interface UsageMetrics {
  claims: number;
  verifications: number;
  documents: number;
  members: number;
  apiKeys: number;
  auditEvents: number;
  claimsByStatus: { status: string; count: number }[];
  verificationsByOutcome: { outcome: string; count: number }[];
}

const TOTAL_CARD_DEFS: { key: keyof UsageMetrics; label: string }[] = [
  { key: "claims", label: "Claims" },
  { key: "verifications", label: "Verifications" },
  { key: "documents", label: "Documents" },
  { key: "members", label: "Members" },
  { key: "apiKeys", label: "Active API keys" },
  { key: "auditEvents", label: "Audit events" },
];

export default function UsagePage() {
  const { canManage, loading: roleLoading } = useCurrentRole();
  const [metrics, setMetrics] = useState<UsageMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<UsageMetrics>("/api/usage");
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load usage metrics.");
      setLoading(false);
      return;
    }
    setMetrics(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!roleLoading && canManage) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, canManage, load]);

  if (!roleLoading && !canManage) {
    return (
      <AdminNoAccess
        title="Usage"
        message="You need an admin or owner role to view usage metrics."
      />
    );
  }

  const cards = TOTAL_CARD_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    value: metrics ? (metrics[def.key] as number) : null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink/80">Usage</h1>
      <p className="mt-1 text-sm text-ink/40">
        Aggregate activity across this organization.
      </p>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <MetricCards cards={cards} loading={loading} />

      {!loading && metrics ? (
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UsageBreakdown
            title="Claims by status"
            rows={metrics.claimsByStatus.map((r) => ({
              label: r.status,
              count: r.count,
            }))}
          />
          <UsageBreakdown
            title="Verifications by outcome"
            rows={metrics.verificationsByOutcome.map((r) => ({
              label: r.outcome,
              count: r.count,
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}

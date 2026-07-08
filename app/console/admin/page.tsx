"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson } from "@/components/admin-audit/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { AdminNoAccess } from "./_components/AdminNoAccess";
import { MetricCards } from "./_components/MetricCards";
import { QuickLinks, type QuickLink } from "./_components/QuickLinks";

interface UsageMetrics {
  claims: number;
  verifications: number;
  documents: number;
  members: number;
  apiKeys: number;
  auditEvents: number;
}

const CARD_DEFS: { key: keyof UsageMetrics; label: string }[] = [
  { key: "claims", label: "Claims" },
  { key: "verifications", label: "Verifications" },
  { key: "documents", label: "Documents" },
  { key: "members", label: "Members" },
  { key: "apiKeys", label: "Active API keys" },
  { key: "auditEvents", label: "Audit events" },
];

const LINKS: QuickLink[] = [
  {
    href: "/console/admin/api-keys",
    label: "API keys",
    desc: "Create and revoke programmatic access keys.",
  },
  {
    href: "/console/admin/usage",
    label: "Usage",
    desc: "Aggregate counts and activity breakdowns.",
  },
  {
    href: "/console/admin/activity",
    label: "Recent activity",
    desc: "The latest actions across the organization.",
  },
  {
    href: "/console/audit",
    label: "Audit log",
    desc: "Review who did what across the organization.",
  },
];

export default function AdminOverviewPage() {
  const { canManage, loading: roleLoading } = useCurrentRole();
  const [metrics, setMetrics] = useState<UsageMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<UsageMetrics>("/api/usage");
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load admin overview.");
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
    return <AdminNoAccess title="Admin" />;
  }

  const cards = CARD_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    value: metrics ? metrics[def.key] : null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink/80">Admin</h1>
      <p className="mt-1 text-sm text-ink/40">
        Organization administration, keys, usage, and audit trail.
      </p>

      <MetricCards cards={cards} loading={loading} />

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

      <QuickLinks links={LINKS} />
    </div>
  );
}

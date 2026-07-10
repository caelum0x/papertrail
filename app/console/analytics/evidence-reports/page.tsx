"use client";

// Org analytics over saved evidence reports: total, GRADE-certainty distribution
// (as a small stacked bar), verdict breakdown, and a recent-reports table linking
// to each report. Mirrors the house analytics style (KpiCard / ChartCard /
// StateBlock) and the client.ts org-header + envelope-unwrap patterns. The
// fetcher is inlined here because this page owns its own endpoint.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ApiResponse } from "@/lib/api/response";
import { StateBlock, KpiCard, ChartCard, BarChart } from "../components";
import { AnalyticsHeader } from "../_components/ModuleHeader";
import { formatDateTime } from "../client";

const ORG_STORAGE_KEY = "pt_active_org";

interface EvidenceReportAnalytics {
  total: number;
  byCertainty: { high: number; moderate: number; low: number; very_low: number };
  byVerdict: Record<string, number>;
  recent: {
    id: string;
    claim: string;
    certainty: string | null;
    verdict: string | null;
    createdAt: string;
  }[];
  perMonth: { month: string; count: number }[];
}

const CERTAINTY_ORDER: { key: keyof EvidenceReportAnalytics["byCertainty"]; label: string; color: string }[] = [
  { key: "high", label: "High", color: "bg-emerald-500" },
  { key: "moderate", label: "Moderate", color: "bg-lime-500" },
  { key: "low", label: "Low", color: "bg-amber-500" },
  { key: "very_low", label: "Very low", color: "bg-red-500" },
];

async function fetchAnalytics(): Promise<{
  data: EvidenceReportAnalytics | null;
  error: string | null;
}> {
  const headers: Record<string, string> = {};
  if (typeof window !== "undefined") {
    const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
    if (orgId) headers["x-org-id"] = orgId;
  }
  try {
    const res = await fetch("/api/analytics/evidence-reports", {
      headers,
      cache: "no-store",
    });
    const body = (await res
      .json()
      .catch(() => null)) as ApiResponse<EvidenceReportAnalytics> | null;
    if (!body) return { data: null, error: "Unexpected response from server." };
    if (!res.ok || !body.success) {
      return { data: null, error: body.error ?? "Request failed." };
    }
    return { data: body.data, error: null };
  } catch {
    return { data: null, error: "Network error loading evidence-report analytics." };
  }
}

function labelForCertainty(value: string | null): string {
  const found = CERTAINTY_ORDER.find((c) => c.key === value);
  return found ? found.label : value ?? "—";
}

// Small stacked bar of the four certainty buckets, width-scaled to the total.
function CertaintyStackedBar({
  byCertainty,
  total,
}: {
  byCertainty: EvidenceReportAnalytics["byCertainty"];
  total: number;
}) {
  if (total === 0) {
    return <p className="py-6 text-center text-sm text-ink/40">No reports yet.</p>;
  }
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded bg-paper">
        {CERTAINTY_ORDER.map((c) => {
          const count = byCertainty[c.key];
          const pct = Math.round((count / total) * 100);
          if (pct === 0) return null;
          return (
            <div
              key={c.key}
              className={c.color}
              style={{ width: `${pct}%` }}
              title={`${c.label}: ${count} (${pct}%)`}
            />
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/60">
        {CERTAINTY_ORDER.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${c.color}`} />
            {c.label}
            <span className="tabular-nums text-ink/40">{byCertainty[c.key]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function EvidenceReportAnalyticsPage() {
  const [data, setData] = useState<EvidenceReportAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchAnalytics();
    if (result.error) {
      setError(result.error);
      setData(null);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const verdictBars = data
    ? Object.entries(data.byVerdict)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)
    : [];

  return (
    <div>
      <AnalyticsHeader active="evidence" />

      <div className="mt-6">
        {loading ? (
          <StateBlock kind="loading" message="Loading evidence-report analytics…" />
        ) : error ? (
          <StateBlock kind="error" message={error} onRetry={load} />
        ) : !data || data.total === 0 ? (
          <StateBlock
            kind="empty"
            message="No saved evidence reports yet. Save a report to populate analytics."
          />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard label="Total reports" value={String(data.total)} />
              <KpiCard
                label="High certainty"
                value={String(data.byCertainty.high)}
                hint="GRADE: high"
              />
              <KpiCard
                label="Verdict types"
                value={String(Object.keys(data.byVerdict).length)}
              />
              <KpiCard
                label="Active months"
                value={String(data.perMonth.length)}
              />
            </div>

            <ChartCard
              title="Certainty distribution"
              description="Saved reports by GRADE certainty of evidence."
            >
              <CertaintyStackedBar
                byCertainty={data.byCertainty}
                total={data.total}
              />
            </ChartCard>

            <ChartCard
              title="Verdict breakdown"
              description="Reports grouped by their recorded verdict."
            >
              <BarChart data={verdictBars} emptyMessage="No verdicts recorded." />
            </ChartCard>

            <ChartCard
              title="Recent reports"
              description="The 10 most recently saved evidence reports."
            >
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/40">
                      <th className="py-2 pr-4 font-medium">Claim</th>
                      <th className="py-2 pr-4 font-medium">Certainty</th>
                      <th className="py-2 pr-4 font-medium">Verdict</th>
                      <th className="py-2 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((r) => (
                      <tr key={r.id} className="border-b border-ink/5 last:border-0">
                        <td className="py-2 pr-4">
                          <Link
                            href={`/console/evidence-reports/${r.id}`}
                            className="text-accent hover:underline"
                            title={r.claim}
                          >
                            <span className="line-clamp-1 max-w-md">{r.claim}</span>
                          </Link>
                        </td>
                        <td className="py-2 pr-4 text-ink/60">
                          {labelForCertainty(r.certainty)}
                        </td>
                        <td className="py-2 pr-4 text-ink/60">{r.verdict ?? "—"}</td>
                        <td className="py-2 text-ink/40">
                          {formatDateTime(r.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </div>
        )}
      </div>
    </div>
  );
}

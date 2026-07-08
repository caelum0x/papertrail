"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWorkflows, fetchRuns } from "../workflowClient";
import type { RunSummary } from "@/lib/workflows/repository";
import { ModuleHeader } from "../_components/ModuleHeader";
import { LoadingPanel, ErrorPanel } from "../_components/StatusPanel";
import { RunStatus } from "../_components/RunStatus";

interface WorkflowOverviewRow {
  key: string;
  name: string;
  source: "builtin" | "custom";
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  lastStatus: string | null;
}

// Aggregates recent runs (via the existing /api/agent-runs endpoint) per
// workflow to give an at-a-glance health picture. Pure read-only; no new APIs.
function summarize(name: string, key: string, source: "builtin" | "custom", runs: RunSummary[]): WorkflowOverviewRow {
  const succeeded = runs.filter((r) => r.status === "succeeded").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const running = runs.filter((r) => r.status === "running").length;
  return {
    key,
    name,
    source,
    total: runs.length,
    succeeded,
    failed,
    running,
    lastStatus: runs[0]?.status ?? null,
  };
}

export default function WorkflowsOverviewPage() {
  const [rows, setRows] = useState<WorkflowOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const wf = await fetchWorkflows();
    if (wf.error || !wf.data) {
      setError(wf.error ?? "Failed to load workflows.");
      setLoading(false);
      return;
    }
    const defs: { key: string; name: string; source: "builtin" | "custom" }[] = [
      ...wf.data.builtin.map((w) => ({
        key: w.key,
        name: w.name,
        source: "builtin" as const,
      })),
      ...wf.data.custom.map((w) => ({
        key: w.definition.key,
        name: w.name,
        source: "custom" as const,
      })),
    ];
    const summaries = await Promise.all(
      defs.map(async (d) => {
        const runs = await fetchRuns(d.key, 1, 50);
        return summarize(d.name, d.key, d.source, runs.data ?? []);
      })
    );
    setRows(summaries);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      succeeded: acc.succeeded + r.succeeded,
      failed: acc.failed + r.failed,
    }),
    { total: 0, succeeded: 0, failed: 0 }
  );

  return (
    <div>
      <ModuleHeader
        title="Workflows overview"
        subtitle="Run activity aggregated per pipeline from recent runs."
        action={
          <Link
            href="/console/workflows"
            className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:text-ink/90"
          >
            Workflows
          </Link>
        }
      />

      {loading ? (
        <div className="mt-6">
          <LoadingPanel label="Loading overview..." />
        </div>
      ) : error ? (
        <div className="mt-6">
          <ErrorPanel message={error} onRetry={load} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-ink/10 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-ink/40">
                Recent runs
              </div>
              <div className="mt-1 text-2xl font-semibold text-ink/80">
                {totals.total}
              </div>
            </div>
            <div className="rounded-lg border border-ink/10 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-ink/40">
                Succeeded
              </div>
              <div className="mt-1 text-2xl font-semibold text-green-700">
                {totals.succeeded}
              </div>
            </div>
            <div className="rounded-lg border border-ink/10 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-ink/40">
                Failed
              </div>
              <div className="mt-1 text-2xl font-semibold text-red-700">
                {totals.failed}
              </div>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-ink/40">
                No workflows found.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wide text-ink/40">
                    <th className="px-4 py-2 font-medium">Workflow</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Runs</th>
                    <th className="px-4 py-2 font-medium">Succeeded</th>
                    <th className="px-4 py-2 font-medium">Failed</th>
                    <th className="px-4 py-2 font-medium">Last</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.source}-${r.key}`}
                      className="border-b border-ink/10 last:border-0 hover:bg-paper"
                    >
                      <td className="px-4 py-3 text-ink/80">{r.name}</td>
                      <td className="px-4 py-3 text-ink/60">{r.source}</td>
                      <td className="px-4 py-3 text-ink/60">{r.total}</td>
                      <td className="px-4 py-3 text-ink/60">{r.succeeded}</td>
                      <td className="px-4 py-3 text-ink/60">{r.failed}</td>
                      <td className="px-4 py-3">
                        {r.lastStatus ? (
                          <RunStatus status={r.lastStatus} />
                        ) : (
                          <span className="text-ink/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/console/workflows/${encodeURIComponent(r.key)}`}
                          className="text-accent hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

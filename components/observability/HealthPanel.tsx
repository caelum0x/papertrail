"use client";

import { useCallback, useEffect, useState } from "react";
import type { HealthReport } from "@/lib/observability/types";
import { fetchHealth } from "@/components/observability/api";
import {
  ErrorState,
  HealthPill,
  LoadingState,
  relativeTime,
} from "@/components/observability/ui";

// Live health card: overall status + per-check rows + build metadata. Polls on
// mount and offers a manual refresh.

function CheckRow({
  name,
  status,
  detail,
  latencyMs,
}: HealthReport["checks"][number]) {
  return (
    <div className="flex items-center justify-between border-t border-ink/10 py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-medium capitalize text-ink">
          {name.replace(/_/g, " ")}
        </p>
        {detail && <p className="truncate text-xs text-ink/50">{detail}</p>}
      </div>
      <div className="flex items-center gap-3">
        {latencyMs !== null && (
          <span className="tabular-nums text-xs text-ink/40">{latencyMs}ms</span>
        )}
        <HealthPill status={status} />
      </div>
    </div>
  );
}

function BuildInfo({ build }: { build: HealthReport["build"] }) {
  const items: { label: string; value: string }[] = [
    { label: "Environment", value: build.environment },
    { label: "Commit", value: build.commit },
    { label: "Region", value: build.region ?? "—" },
    { label: "Node", value: build.node },
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-ink/10 pt-4 sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label}>
          <dt className="text-[11px] uppercase tracking-wide text-ink/40">
            {it.label}
          </dt>
          <dd className="truncate text-sm text-ink/80" title={it.value}>
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function HealthPanel() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchHealth();
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load health.");
      setLoading(false);
      return;
    }
    setReport(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/70">System health</h2>
        <div className="flex items-center gap-3">
          {report && (
            <span className="text-xs text-ink/40">
              checked {relativeTime(report.checkedAt)}
            </span>
          )}
          {report && <HealthPill status={report.status} />}
          <button
            onClick={() => void load()}
            className="rounded border border-ink/10 px-2 py-1 text-xs text-ink/60 hover:bg-paper"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && !report ? (
        <LoadingState label="Checking systems…" />
      ) : error ? (
        <div className="mt-4">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : report ? (
        <>
          <div className="mt-3">
            {report.checks.map((c) => (
              <CheckRow key={c.name} {...c} />
            ))}
          </div>
          <BuildInfo build={report.build} />
        </>
      ) : null}
    </section>
  );
}

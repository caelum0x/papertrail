"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { fetchRun } from "../../workflowClient";
import type { RunDetail } from "@/lib/workflows/repository";
import { LoadingPanel, ErrorPanel } from "../../_components/StatusPanel";
import { RunSummaryCard } from "../../_components/RunSummaryCard";
import { StepCard } from "../../_components/StepCard";

export default function RunTracePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const result = await fetchRun(id);
    if (result.error || !result.data) {
      setError(result.error ?? "Run not found.");
      setRun(null);
    } else {
      setRun(result.data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-3xl">
      <Link
        href="/console/workflows/runs"
        className="text-sm text-accent hover:underline"
      >
        ← Back to runs
      </Link>

      {loading ? (
        <div className="mt-6">
          <LoadingPanel label="Loading run..." />
        </div>
      ) : error ? (
        <div className="mt-6">
          <ErrorPanel message={error} onRetry={load} />
        </div>
      ) : run ? (
        <div className="mt-6 space-y-4">
          <RunSummaryCard run={run} />

          <div>
            <h2 className="text-xs font-medium uppercase tracking-wide text-ink/40">
              Steps
            </h2>
            {run.steps.length === 0 ? (
              <div className="mt-3 rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
                This run recorded no steps.
              </div>
            ) : (
              <ol className="mt-3 space-y-2">
                {run.steps.map((s) => (
                  <StepCard key={s.id} step={s} />
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ApiResponse } from "@/lib/api/response";
import {
  orgHeaders,
  formatTime,
  type EvalRun,
  type EvalResultRecord,
} from "../../lib";
import { StatusBadge } from "../../_components/Badges";
import { RunMetricCards } from "../../_components/RunMetricCards";
import { ResultsTable } from "../../_components/ResultsTable";

interface RunDetail {
  run: EvalRun;
  results: EvalResultRecord[];
}

export default function EvalRunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params?.id;

  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/eval-runs/${runId}`, {
        headers: { ...orgHeaders() },
        cache: "no-store",
      });
      const body: ApiResponse<RunDetail> = await res.json();
      if (!res.ok || !body.success) {
        setError(body.error ?? "Failed to load run.");
        setDetail(null);
      } else {
        setDetail(body.data ?? null);
      }
    } catch {
      setError("Network error loading run.");
      setDetail(null);
    }
    setLoading(false);
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-ink/40">Loading run…</p>;
  }
  if (error) {
    return (
      <div>
        <p className="text-sm text-red-700">{error}</p>
        <button onClick={load} className="mt-3 text-sm text-accent hover:underline">
          Try again
        </button>
      </div>
    );
  }
  if (!detail) {
    return <p className="text-sm text-ink/40">Run not found.</p>;
  }

  const { run, results } = detail;

  return (
    <div>
      <Link
        href={`/console/evaluation/${run.evalSetId}`}
        className="text-sm text-accent hover:underline"
      >
        ← Back to eval set
      </Link>

      <div className="mt-3 flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink/80">
          Run {run.id.slice(0, 8)}
        </h1>
        <StatusBadge status={run.status} />
      </div>
      <p className="mt-1 text-xs text-ink/40">{formatTime(run.createdAt)}</p>

      <RunMetricCards run={run} />

      <ResultsTable results={results} />
    </div>
  );
}

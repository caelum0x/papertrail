"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchRuns } from "../workflowClient";
import type { RunSummary } from "@/lib/workflows/repository";
import { ModuleHeader } from "../_components/ModuleHeader";
import { RunsTable } from "../_components/RunsTable";
import { Pagination } from "../_components/Pagination";
import {
  LoadingPanel,
  ErrorPanel,
  EmptyPanel,
} from "../_components/StatusPanel";

const PAGE_SIZE = 20;

export default function WorkflowRunsPage() {
  const [items, setItems] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchRuns(null, page, PAGE_SIZE);
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <ModuleHeader
        title="Workflow runs"
        subtitle="Every pipeline execution with its status and trace."
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
        <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white">
          <div className="p-8 text-center text-sm text-ink/40">
            Loading runs...
          </div>
        </div>
      ) : error ? (
        <div className="mt-6">
          <ErrorPanel message={error} onRetry={load} />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6">
          <EmptyPanel>No runs yet. Run a workflow to see it here.</EmptyPanel>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white">
          <RunsTable items={items} />
        </div>
      )}

      {!loading && !error && total > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}

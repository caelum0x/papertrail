"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  fetchDefinition,
  fetchRuns,
  runDefinition,
} from "@/lib/reporting/client";
import type {
  ReportDefinition,
  ReportFormat,
  ReportRun,
} from "@/lib/reporting/types";
import { ReportHeader } from "../_components/ReportHeader";
import { RunsTable } from "../_components/RunsTable";
import { RunDetail } from "../_components/RunDetail";
import { StateBlock } from "../_components/StateBlock";
import { Pagination } from "../_components/Pagination";
import { useActiveOrgRole, canEdit } from "../_components/useActiveOrgRole";

const PAGE_SIZE = 20;

export default function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const role = useActiveOrgRole();

  const [definition, setDefinition] = useState<ReportDefinition | null>(null);
  const [defLoading, setDefLoading] = useState(true);
  const [defError, setDefError] = useState<string | null>(null);

  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  const [selected, setSelected] = useState<ReportRun | null>(null);
  const [format, setFormat] = useState<ReportFormat>("json");
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadDefinition = useCallback(async () => {
    if (!id) return;
    setDefLoading(true);
    setDefError(null);
    const res = await fetchDefinition(id);
    if (res.error || !res.data) {
      setDefError(res.error ?? "Report not found.");
      setDefinition(null);
    } else {
      setDefinition(res.data);
    }
    setDefLoading(false);
  }, [id]);

  const loadRuns = useCallback(async () => {
    if (!id) return;
    setRunsLoading(true);
    setRunsError(null);
    const res = await fetchRuns(id, page, PAGE_SIZE);
    if (res.error) {
      setRunsError(res.error);
      setRuns([]);
      setTotal(0);
    } else {
      setRuns(res.data ?? []);
      setTotal(res.total);
    }
    setRunsLoading(false);
  }, [id, page]);

  useEffect(() => {
    loadDefinition();
  }, [loadDefinition]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const onRun = useCallback(async () => {
    if (!id) return;
    setRunning(true);
    setActionError(null);
    const res = await runDefinition(id, format);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Failed to run report.");
    } else {
      setSelected(res.data);
      setPage(1);
      await loadRuns();
    }
    setRunning(false);
  }, [id, format, loadRuns]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (defLoading) {
    return <StateBlock kind="loading" message="Loading report..." />;
  }
  if (defError || !definition) {
    return (
      <div>
        <StateBlock
          kind="error"
          message={defError ?? "Report not found."}
          onRetry={loadDefinition}
        />
        <div className="mt-4">
          <Link
            href="/console/reporting"
            className="text-sm text-accent hover:underline"
          >
            ← Back to reports
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <ReportHeader
        definition={definition}
        canEdit={canEdit(role)}
        running={running}
        format={format}
        onFormatChange={setFormat}
        onRun={onRun}
      />

      {actionError ? (
        <p className="mt-3 text-sm text-red-700">{actionError}</p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink/70">Runs</h2>
          <div className="overflow-hidden rounded-lg border border-ink/15 bg-white">
            {runsLoading ? (
              <StateBlock kind="loading" message="Loading runs..." />
            ) : runsError ? (
              <StateBlock kind="error" message={runsError} onRetry={loadRuns} />
            ) : runs.length === 0 ? (
              <StateBlock
                kind="empty"
                message="No runs yet. Run this report to generate one."
              />
            ) : (
              <RunsTable
                runs={runs}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />
            )}
          </div>
          {!runsLoading && !runsError && total > PAGE_SIZE ? (
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          ) : null}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink/70">Result</h2>
          <RunDetail run={selected} />
        </div>
      </div>
    </div>
  );
}

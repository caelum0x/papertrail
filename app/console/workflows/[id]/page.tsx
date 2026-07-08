"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchWorkflow,
  fetchRuns,
  startRun,
  type WorkflowDetail,
} from "../workflowClient";
import type { RunSummary } from "@/lib/workflows/repository";
import { LoadingPanel, ErrorPanel } from "../_components/StatusPanel";
import { WorkflowSteps } from "../_components/WorkflowSteps";
import { RunWorkflowForm } from "../_components/RunWorkflowForm";
import { RecentRunsTable } from "../_components/RecentRunsTable";

export default function WorkflowDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();

  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [claim, setClaim] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const wf = await fetchWorkflow(id);
    if (wf.error || !wf.data) {
      setError(wf.error ?? "Workflow not found.");
      setWorkflow(null);
      setLoading(false);
      return;
    }
    setWorkflow(wf.data);
    const runList = await fetchRuns(wf.data.definition.key, 1, 10);
    setRuns(runList.data ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onRun = useCallback(async () => {
    if (!workflow || !claim.trim()) return;
    setRunning(true);
    setRunError(null);
    const result = await startRun(workflow.definition.key, claim);
    if (result.error || !result.data) {
      setRunError(result.error ?? "Failed to start run.");
      setRunning(false);
      return;
    }
    router.push(`/console/workflows/runs/${result.data.runId}`);
  }, [workflow, claim, router]);

  return (
    <div className="max-w-3xl">
      <Link
        href="/console/workflows"
        className="text-sm text-accent hover:underline"
      >
        ← Back to workflows
      </Link>

      {loading ? (
        <div className="mt-6">
          <LoadingPanel label="Loading workflow..." />
        </div>
      ) : error ? (
        <div className="mt-6">
          <ErrorPanel message={error} onRetry={load} />
        </div>
      ) : workflow ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-ink/15 bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-ink/80">
                  {workflow.name}
                </h1>
                <p className="mt-1 text-sm text-ink/40">
                  {workflow.description}
                </p>
              </div>
              <span className="rounded-full bg-paper px-2 py-0.5 text-xs text-ink/40">
                {workflow.source}
              </span>
            </div>

            <WorkflowSteps steps={workflow.definition.steps} />
          </div>

          <RunWorkflowForm
            claim={claim}
            onClaimChange={setClaim}
            onRun={onRun}
            running={running}
            error={runError}
          />

          <RecentRunsTable runs={runs} />
        </div>
      ) : null}
    </div>
  );
}

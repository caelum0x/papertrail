"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWorkflows, type WorkflowsPayload } from "./workflowClient";
import { ModuleHeader } from "./_components/ModuleHeader";
import { LoadingPanel, ErrorPanel } from "./_components/StatusPanel";
import {
  BuiltinPipelines,
  CustomPipelines,
} from "./_components/WorkflowGrid";

export default function WorkflowsPage() {
  const [data, setData] = useState<WorkflowsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchWorkflows();
    if (result.error || !result.data) {
      setError(result.error ?? "Failed to load workflows.");
      setData(null);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <ModuleHeader
        title="Workflows"
        subtitle="Composable agentic pipelines. Run a built-in pipeline against a claim and inspect every step in the trace viewer."
        action={
          <div className="flex gap-2">
            <Link
              href="/console/workflows/overview"
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:text-ink/90"
            >
              Overview
            </Link>
            <Link
              href="/console/workflows/runs"
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:text-ink/90"
            >
              View runs
            </Link>
          </div>
        }
      />

      {loading ? (
        <div className="mt-6">
          <LoadingPanel label="Loading workflows..." />
        </div>
      ) : error ? (
        <div className="mt-6">
          <ErrorPanel message={error} onRetry={load} />
        </div>
      ) : (
        <>
          <BuiltinPipelines items={data?.builtin ?? []} />
          <CustomPipelines items={data?.custom ?? []} />
        </>
      )}
    </div>
  );
}

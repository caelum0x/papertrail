"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Job } from "@/lib/jobs/types";
import { fetchJob, retryJob } from "../_components/client";
import { StatusBadge } from "../_components/StatusBadge";
import { formatTime } from "../_components/status";
import { TableCard, TableLoading, TableError } from "../_components/TableStates";

// Job detail sub-page: full metadata, payload and result JSON, plus retry for
// finished jobs — all from the existing GET /api/jobs/[id] endpoint.
export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const result = await fetchJob(id);
    if (result.error) {
      setError(result.error);
      setJob(null);
    } else {
      setJob(result.data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onRetry = useCallback(async () => {
    if (!id) return;
    setRetrying(true);
    setNotice(null);
    const result = await retryJob(id);
    if (result.error) {
      setNotice(result.error);
    } else {
      setNotice("Job re-queued.");
      await load();
    }
    setRetrying(false);
  }, [id, load]);

  const canRetry =
    job?.status === "failed" || job?.status === "completed";

  return (
    <div className="max-w-3xl">
      <Link href="/console/jobs" className="text-sm text-accent hover:underline">
        ← Back to jobs
      </Link>

      <div className="mt-4">
        {loading ? (
          <TableCard>
            <TableLoading>Loading job…</TableLoading>
          </TableCard>
        ) : error ? (
          <TableCard>
            <TableError message={error} onRetry={load} />
          </TableCard>
        ) : !job ? (
          <TableCard>
            <TableLoading>Job not found.</TableLoading>
          </TableCard>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-mono text-xl font-semibold text-ink/80">
                  {job.type}
                </h1>
                <p className="mt-1 font-mono text-xs text-ink/40">{job.id}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <StatusBadge status={job.status} />
                {canRetry ? (
                  <button
                    onClick={onRetry}
                    disabled={retrying}
                    className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/80 hover:border-accent disabled:opacity-50"
                  >
                    {retrying ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
              </div>
            </div>

            {notice ? <p className="text-sm text-ink/60">{notice}</p> : null}

            <dl className="grid grid-cols-2 gap-4 rounded-lg border border-ink/15 bg-white p-6 text-sm sm:grid-cols-3">
              <Field label="Attempts" value={`${job.attempts}/${job.maxAttempts}`} />
              <Field label="Run after" value={formatTime(job.runAfter)} />
              <Field label="Locked at" value={formatTime(job.lockedAt)} />
              <Field label="Created" value={formatTime(job.createdAt)} />
              <Field label="Updated" value={formatTime(job.updatedAt)} />
            </dl>

            {job.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <h2 className="text-xs font-medium uppercase tracking-wide text-red-700">
                  Error
                </h2>
                <p className="mt-1 text-sm text-red-700">{job.error}</p>
              </div>
            ) : null}

            <JsonBlock label="Payload" value={job.payload} />
            {job.result ? (
              <JsonBlock label="Result" value={job.result} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink/40">{label}</dt>
      <dd className="mt-0.5 text-ink/70">{value}</dd>
    </div>
  );
}

function JsonBlock({
  label,
  value,
}: {
  label: string;
  value: Record<string, unknown>;
}) {
  return (
    <div>
      <h2 className="text-sm font-medium text-ink/70">{label}</h2>
      <pre className="mt-2 overflow-auto rounded-lg border border-ink/15 bg-white p-4 font-mono text-xs text-ink/70">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import type { Job } from "@/lib/jobs/types";
import {
  fetchJobs,
  enqueueJob,
  retryJob,
  processTick,
  parsePayload,
} from "./_components/client";
import { EnqueueForm } from "./_components/EnqueueForm";
import { JobsTable } from "./_components/JobsTable";
import {
  TableCard,
  TableLoading,
  TableError,
  SimplePagination,
} from "./_components/TableStates";

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
];

export default function JobsPage() {
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newType, setNewType] = useState("noop");
  const [newPayload, setNewPayload] = useState("{}");
  const [enqueuing, setEnqueuing] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchJobs({ status, page, limit: PAGE_SIZE });
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data);
      setTotal(result.total);
    }
    setLoading(false);
  }, [status, page]);

  useEffect(() => {
    load();
  }, [load]);

  const enqueue = useCallback(async () => {
    setNotice(null);
    const { payload, error: payloadError } = parsePayload(newPayload);
    if (payloadError) {
      setNotice(payloadError);
      return;
    }
    setEnqueuing(true);
    const result = await enqueueJob({ type: newType.trim(), payload });
    if (result.error) {
      setNotice(result.error);
    } else {
      setNotice(`Enqueued ${result.data?.type} job.`);
      setPage(1);
      await load();
    }
    setEnqueuing(false);
  }, [newType, newPayload, load]);

  const retry = useCallback(
    async (id: string) => {
      setNotice(null);
      const result = await retryJob(id);
      if (result.error) {
        setNotice(result.error);
      } else {
        await load();
      }
    },
    [load]
  );

  const tick = useCallback(async () => {
    setNotice(null);
    setTicking(true);
    const result = await processTick();
    if (result.error) {
      setNotice(result.error);
    } else {
      setNotice(
        `Tick: ${result.data?.processedJobs ?? 0} job(s) run, ${
          result.data?.firedSchedules ?? 0
        } schedule(s) fired.`
      );
      await load();
    }
    setTicking(false);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">Jobs</h1>
          <p className="mt-1 text-sm text-ink/40">
            Background job queue. Enqueue work, watch status, and retry failures.
          </p>
        </div>
        <button
          onClick={tick}
          disabled={ticking}
          className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/80 hover:border-accent disabled:opacity-50"
        >
          {ticking ? "Processing…" : "Process tick"}
        </button>
      </div>

      <EnqueueForm
        type={newType}
        payload={newPayload}
        enqueuing={enqueuing}
        notice={notice}
        onTypeChange={setNewType}
        onPayloadChange={setNewPayload}
        onEnqueue={enqueue}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={load}
          className="text-sm text-accent hover:underline"
          type="button"
        >
          Refresh
        </button>
      </div>

      <div className="mt-4">
        <TableCard>
          {loading ? (
            <TableLoading>Loading jobs…</TableLoading>
          ) : error ? (
            <TableError message={error} onRetry={load} />
          ) : items.length === 0 ? (
            <TableLoading>
              No jobs yet. Enqueue one above to see it here.
            </TableLoading>
          ) : (
            <JobsTable items={items} onRetry={retry} />
          )}
        </TableCard>
      </div>

      {totalPages > 1 ? (
        <SimplePagination
          page={page}
          totalPages={totalPages}
          total={total}
          noun="job"
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}

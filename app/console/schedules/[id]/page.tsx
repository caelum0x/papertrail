"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { Schedule } from "@/lib/jobs/types";
import {
  toggleSchedule,
  deleteSchedule,
  formatTime,
} from "../_components/client";
import { fetchScheduleById } from "../_components/client-detail";
import {
  TableCard,
  TableLoading,
  TableError,
} from "../../jobs/_components/TableStates";

// Schedule detail sub-page: full metadata plus enable/disable and delete,
// using the existing list (fetch-then-find) and PATCH/DELETE endpoints.
export default function ScheduleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? "";

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const result = await fetchScheduleById(id);
    if (result.error) {
      setError(result.error);
      setSchedule(null);
    } else {
      setSchedule(result.data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onToggle = useCallback(async () => {
    if (!schedule) return;
    setBusy(true);
    setNotice(null);
    const result = await toggleSchedule(schedule);
    if (result.error) {
      setNotice(result.error);
    } else {
      await load();
    }
    setBusy(false);
  }, [schedule, load]);

  const onDelete = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setNotice(null);
    const result = await deleteSchedule(id);
    if (result.error) {
      setNotice(result.error);
      setBusy(false);
    } else {
      router.push("/console/schedules");
    }
  }, [id, router]);

  return (
    <div className="max-w-3xl">
      <Link
        href="/console/schedules"
        className="text-sm text-accent hover:underline"
      >
        ← Back to schedules
      </Link>

      <div className="mt-4">
        {loading ? (
          <TableCard>
            <TableLoading>Loading schedule…</TableLoading>
          </TableCard>
        ) : error ? (
          <TableCard>
            <TableError message={error} onRetry={load} />
          </TableCard>
        ) : !schedule ? (
          <TableCard>
            <TableLoading>Schedule not found.</TableLoading>
          </TableCard>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-ink/80">
                  {schedule.name}
                </h1>
                <p className="mt-1 font-mono text-xs text-ink/40">
                  {schedule.cron}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
                    schedule.enabled
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-ink/15 bg-paper text-ink/50"
                  }`}
                >
                  {schedule.enabled ? "enabled" : "disabled"}
                </span>
                <button
                  onClick={onToggle}
                  disabled={busy}
                  className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/80 hover:border-accent disabled:opacity-50"
                >
                  {schedule.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={onDelete}
                  disabled={busy}
                  className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 hover:border-red-400 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>

            {notice ? <p className="text-sm text-ink/60">{notice}</p> : null}

            <dl className="grid grid-cols-2 gap-4 rounded-lg border border-ink/15 bg-white p-6 text-sm sm:grid-cols-3">
              <Field label="Job type" value={schedule.type} mono />
              <Field label="Last run" value={formatTime(schedule.lastRunAt)} />
              <Field label="Next run" value={formatTime(schedule.nextRunAt)} />
              <Field label="Created" value={formatTime(schedule.createdAt)} />
              <Field label="Updated" value={formatTime(schedule.updatedAt)} />
            </dl>

            <div>
              <h2 className="text-sm font-medium text-ink/70">Payload</h2>
              <pre className="mt-2 overflow-auto rounded-lg border border-ink/15 bg-white p-4 font-mono text-xs text-ink/70">
                {JSON.stringify(schedule.payload, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink/40">{label}</dt>
      <dd className={`mt-0.5 text-ink/70 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

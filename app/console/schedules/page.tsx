"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Schedule } from "@/lib/jobs/types";
import {
  fetchSchedules,
  createSchedule,
  toggleSchedule,
  deleteSchedule,
  parsePayload,
} from "./_components/client";
import { ScheduleForm } from "./_components/ScheduleForm";
import { SchedulesTable } from "./_components/SchedulesTable";
import {
  TableCard,
  TableLoading,
  TableError,
  SimplePagination,
} from "../jobs/_components/TableStates";

const PAGE_SIZE = 20;

export default function SchedulesPage() {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Schedule[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState("noop");
  const [cron, setCron] = useState("0 * * * *");
  const [payload, setPayload] = useState("{}");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchSchedules({ page, limit: PAGE_SIZE });
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    setNotice(null);
    const { payload: parsedPayload, error: payloadError } = parsePayload(payload);
    if (payloadError) {
      setNotice(payloadError);
      return;
    }
    setCreating(true);
    const result = await createSchedule({
      name: name.trim(),
      type: type.trim(),
      cron: cron.trim(),
      payload: parsedPayload,
    });
    if (result.error) {
      setNotice(result.error);
    } else {
      setNotice(`Created schedule "${result.data?.name}".`);
      setName("");
      setPayload("{}");
      setPage(1);
      await load();
    }
    setCreating(false);
  }, [name, type, cron, payload, load]);

  const toggle = useCallback(
    async (schedule: Schedule) => {
      setNotice(null);
      const result = await toggleSchedule(schedule);
      if (result.error) {
        setNotice(result.error);
      } else {
        await load();
      }
    },
    [load]
  );

  const remove = useCallback(
    async (id: string) => {
      setNotice(null);
      const result = await deleteSchedule(id);
      if (result.error) {
        setNotice(result.error);
      } else {
        await load();
      }
    },
    [load]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">Schedules</h1>
          <p className="mt-1 text-sm text-ink/40">
            Cron-like schedules that enqueue background jobs on a recurring basis
            (UTC, standard 5-field crontab).
          </p>
          <div className="mt-2">
            <Link
              href="/console/schedules/overview"
              className="text-xs font-medium text-accent hover:underline"
            >
              View schedule overview →
            </Link>
          </div>
        </div>
      </div>

      <ScheduleForm
        name={name}
        type={type}
        cron={cron}
        payload={payload}
        creating={creating}
        notice={notice}
        onNameChange={setName}
        onTypeChange={setType}
        onCronChange={setCron}
        onPayloadChange={setPayload}
        onCreate={create}
      />

      <div className="mt-6">
        <TableCard>
          {loading ? (
            <TableLoading>Loading schedules…</TableLoading>
          ) : error ? (
            <TableError message={error} onRetry={load} />
          ) : items.length === 0 ? (
            <TableLoading>No schedules yet. Create one above.</TableLoading>
          ) : (
            <SchedulesTable items={items} onToggle={toggle} onDelete={remove} />
          )}
        </TableCard>
      </div>

      {totalPages > 1 ? (
        <SimplePagination
          page={page}
          totalPages={totalPages}
          total={total}
          noun="schedule"
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}

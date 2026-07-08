"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchSchedules,
  fetchDefinitions,
  createSchedule,
  updateSchedule,
  deleteSchedule,
} from "@/lib/reporting/client";
import type {
  ReportDefinition,
  ScheduledReport,
} from "@/lib/reporting/types";
import { ModuleHeader } from "../_components/ModuleHeader";
import { ScheduledList } from "../_components/ScheduledList";
import { ScheduleForm } from "../_components/ScheduleForm";
import { StateBlock } from "../_components/StateBlock";
import { Pagination } from "../_components/Pagination";
import { useActiveOrgRole, canEdit } from "../_components/useActiveOrgRole";

const PAGE_SIZE = 20;

export default function ScheduledReportsPage() {
  const role = useActiveOrgRole();
  const editable = canEdit(role);

  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchSchedules(page, PAGE_SIZE);
    if (res.error) {
      setError(res.error);
      setSchedules([]);
      setTotal(0);
    } else {
      setSchedules(res.data ?? []);
      setTotal(res.total);
    }
    setLoading(false);
  }, [page]);

  const loadDefinitions = useCallback(async () => {
    const res = await fetchDefinitions(null, 1, 100);
    if (!res.error) {
      setDefinitions(res.data ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (editable) loadDefinitions();
  }, [editable, loadDefinitions]);

  const onCreate = useCallback(
    async (input: {
      definitionId: string;
      cron: string;
      recipients: string[];
      enabled: boolean;
    }) => {
      setSubmitting(true);
      setActionError(null);
      const res = await createSchedule(input);
      if (res.error || !res.data) {
        setActionError(res.error ?? "Failed to create schedule.");
      } else {
        setPage(1);
        await load();
      }
      setSubmitting(false);
    },
    [load]
  );

  const onToggle = useCallback(
    async (schedule: ScheduledReport) => {
      setBusyId(schedule.id);
      setActionError(null);
      const res = await updateSchedule(schedule.id, {
        enabled: !schedule.enabled,
      });
      if (res.error || !res.data) {
        setActionError(res.error ?? "Failed to update schedule.");
      } else {
        await load();
      }
      setBusyId(null);
    },
    [load]
  );

  const onDelete = useCallback(
    async (schedule: ScheduledReport) => {
      setBusyId(schedule.id);
      setActionError(null);
      const res = await deleteSchedule(schedule.id);
      if (res.error) {
        setActionError(res.error);
      } else {
        await load();
      }
      setBusyId(null);
    },
    [load]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <ModuleHeader
        title="Scheduled reports"
        description="Attach a cron schedule and recipients to a report so runs are produced automatically."
        actions={
          <Link
            href="/console/reporting"
            className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
          >
            Back to reports
          </Link>
        }
      />

      {actionError ? (
        <p className="mt-3 text-sm text-red-700">{actionError}</p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="overflow-hidden rounded-lg border border-ink/15 bg-white">
            {loading ? (
              <StateBlock kind="loading" message="Loading schedules..." />
            ) : error ? (
              <StateBlock kind="error" message={error} onRetry={load} />
            ) : schedules.length === 0 ? (
              <StateBlock
                kind="empty"
                message="No scheduled reports yet."
              />
            ) : (
              <ScheduledList
                schedules={schedules}
                canEdit={editable}
                busyId={busyId}
                onToggle={onToggle}
                onDelete={onDelete}
              />
            )}
          </div>
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

        <div>
          {editable ? (
            <ScheduleForm
              definitions={definitions}
              submitting={submitting}
              onSubmit={onCreate}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-ink/15 bg-paper p-5 text-sm text-ink/40">
              You need editor access to schedule reports.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

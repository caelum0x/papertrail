"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { MonitorSourceType } from "@/lib/monitoring/types";
import {
  fetchMonitors,
  createMonitor,
  runMonitor,
  type CreateMonitorPayload,
} from "@/components/monitoring/api";
import type { Monitor } from "@/lib/monitoring/types";
import { ModuleHeader } from "./_components/ModuleHeader";
import { MonitorForm } from "./_components/MonitorForm";
import { MonitorRow } from "./_components/MonitorRow";
import { Pagination } from "./_components/Pagination";
import { StateCard, ErrorCard } from "./_components/StateCard";

const PAGE_SIZE = 20;

const EMPTY_FORM: CreateMonitorPayload = {
  name: "",
  query: "",
  sources: ["pubmed", "clinicaltrials"],
  frequency: "weekly",
  enabled: true,
};

export default function MonitoringPage() {
  const [items, setItems] = useState<Monitor[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateMonitorPayload>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [runningId, setRunningId] = useState<string | null>(null);
  const [runNote, setRunNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMonitors({ page, limit: PAGE_SIZE });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  const toggleSource = useCallback((source: MonitorSourceType) => {
    setForm((f) => {
      const has = f.sources.includes(source);
      const next = has
        ? f.sources.filter((s) => s !== source)
        : [...f.sources, source];
      return { ...f, sources: next.length > 0 ? next : f.sources };
    });
  }, []);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setFormError(null);
      try {
        await createMonitor({
          name: form.name.trim(),
          query: form.query.trim(),
          sources: form.sources,
          frequency: form.frequency,
          enabled: form.enabled,
        });
        setForm(EMPTY_FORM);
        setShowForm(false);
        setPage(1);
        await load();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Couldn't create the monitor."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [form, load]
  );

  const onRun = useCallback(
    async (id: string) => {
      setRunningId(id);
      setRunNote(null);
      try {
        const result = await runMonitor(id);
        setRunNote(
          `Checked ${result.considered} source${
            result.considered === 1 ? "" : "s"
          } — ${result.new_hits} new hit${result.new_hits === 1 ? "" : "s"}.`
        );
        await load();
      } catch (err) {
        setRunNote(
          err instanceof Error ? err.message : "Couldn't run the monitor."
        );
      } finally {
        setRunningId(null);
      }
    },
    [load]
  );

  return (
    <div>
      <ModuleHeader
        title="Literature monitoring"
        description="Scheduled safety-literature monitors over PubMed and ClinicalTrials.gov. Run a monitor to surface new sources for triage."
        actionLabel={showForm ? "Cancel" : "New monitor"}
        onAction={() => {
          setShowForm((v) => !v);
          setFormError(null);
        }}
      />

      <div className="mt-2">
        <Link
          href="/console/monitoring/overview"
          className="text-xs font-medium text-accent hover:underline"
        >
          View monitoring overview →
        </Link>
      </div>

      {showForm ? (
        <MonitorForm
          form={form}
          submitting={submitting}
          formError={formError}
          onChange={setForm}
          onToggleSource={toggleSource}
          onSubmit={onSubmit}
        />
      ) : null}

      {runNote ? <p className="mt-4 text-sm text-ink/60">{runNote}</p> : null}

      <div className="mt-6">
        {loading ? (
          <StateCard>Loading monitors...</StateCard>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <StateCard>
            No monitors yet. Create one to start watching the safety literature.
          </StateCard>
        ) : (
          <ul className="space-y-3">
            {items.map((monitor) => (
              <MonitorRow
                key={monitor.id}
                monitor={monitor}
                running={runningId === monitor.id}
                onRun={(id) => void onRun(id)}
              />
            ))}
          </ul>
        )}
      </div>

      {!loading && !error && total > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          noun="monitor"
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}

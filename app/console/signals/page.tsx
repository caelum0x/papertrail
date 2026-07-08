"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AeSignal, AeSeverity, AeStatus } from "@/lib/monitoring/types";
import {
  fetchSignals,
  createSignal,
  updateSignal,
  type CreateSignalPayload,
} from "@/components/monitoring/api";
import { SignalFilters } from "./_components/SignalFilters";
import { SignalForm } from "./_components/SignalForm";
import { SignalRow } from "./_components/SignalRow";
import { Pagination } from "./_components/Pagination";
import { StateCard, ErrorCard } from "./_components/StateCard";

const PAGE_SIZE = 20;

const EMPTY_FORM: CreateSignalPayload = {
  drug: "",
  event: "",
  severity: "moderate",
  status: "open",
  notes: null,
};

export default function SignalsPage() {
  const [items, setItems] = useState<AeSignal[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<AeStatus | "">("");
  const [severityFilter, setSeverityFilter] = useState<AeSeverity | "">("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateSignalPayload>(EMPTY_FORM);
  const [notesRaw, setNotesRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, severityFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSignals({
        status: statusFilter,
        severity: severityFilter,
        page,
        limit: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total]
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setFormError(null);
      try {
        await createSignal({
          drug: form.drug.trim(),
          event: form.event.trim(),
          severity: form.severity,
          status: form.status,
          notes: notesRaw.trim() || null,
        });
        setForm(EMPTY_FORM);
        setNotesRaw("");
        setShowForm(false);
        setPage(1);
        await load();
      } catch (err) {
        setFormError(
          err instanceof Error ? err.message : "Couldn't create the signal."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [form, notesRaw, load]
  );

  const onChangeStatus = useCallback(async (id: string, status: AeStatus) => {
    setUpdatingId(id);
    try {
      const updated = await updateSignal(id, { status });
      setItems((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the signal.");
    } finally {
      setUpdatingId(null);
    }
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">
            Adverse-event signals
          </h1>
          <p className="mt-1 text-sm text-ink/40">
            Triage board for drug/event safety signals under review.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setFormError(null);
          }}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          {showForm ? "Cancel" : "New signal"}
        </button>
      </div>

      <div className="mt-2">
        <Link
          href="/console/signals/board"
          className="text-xs font-medium text-accent hover:underline"
        >
          View signal board →
        </Link>
      </div>

      {showForm ? (
        <SignalForm
          form={form}
          notes={notesRaw}
          submitting={submitting}
          formError={formError}
          onChange={setForm}
          onNotesChange={setNotesRaw}
          onSubmit={onSubmit}
        />
      ) : null}

      <SignalFilters
        statusFilter={statusFilter}
        severityFilter={severityFilter}
        onStatusChange={setStatusFilter}
        onSeverityChange={setSeverityFilter}
      />

      <div className="mt-4">
        {loading ? (
          <StateCard>Loading signals...</StateCard>
        ) : error ? (
          <ErrorCard message={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <StateCard>No signals yet. Raise one to start the triage board.</StateCard>
        ) : (
          <ul className="space-y-3">
            {items.map((signal) => (
              <SignalRow
                key={signal.id}
                signal={signal}
                updating={updatingId === signal.id}
                onChangeStatus={(id, status) => void onChangeStatus(id, status)}
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
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { scienceGet, scienceSend } from "@/lib/science/apiClient";
import type { ScienceSession } from "@/lib/science/clientTypes";
import { ModuleHeader } from "./_components/ModuleHeader";
import { NewSessionForm } from "./_components/NewSessionForm";
import { SessionList, SessionEmptyState } from "./_components/SessionList";
import { Pagination } from "./_components/Pagination";

const PAGE_LIMIT = 20;

export default function ScienceSessionsPage() {
  const [sessions, setSessions] = useState<ScienceSession[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    const res = await scienceGet<ScienceSession[]>(
      `/api/science/sessions?page=${p}&limit=${PAGE_LIMIT}`
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load research sessions.");
      setLoading(false);
      return;
    }
    setSessions(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const onCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) {
        setFormError("Title is required.");
        return;
      }
      setSubmitting(true);
      setFormError(null);
      const res = await scienceSend<ScienceSession>(
        "/api/science/sessions",
        "POST",
        { title: title.trim() }
      );
      setSubmitting(false);
      if (!res.success) {
        setFormError(res.error ?? "Failed to create session.");
        return;
      }
      setTitle("");
      setShowForm(false);
      setPage(1);
      void load(1);
    },
    [title, load]
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div>
      <ModuleHeader
        title="Claude Science"
        subtitle="Literature-review research sessions with a Claude-backed assistant."
        actions={
          <>
            <Link
              href="/console/settings/science"
              className="text-sm text-accent hover:underline"
            >
              Connection settings
            </Link>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90"
            >
              {showForm ? "Cancel" : "New session"}
            </button>
          </>
        }
      />

      {showForm ? (
        <NewSessionForm
          title={title}
          onTitleChange={setTitle}
          onSubmit={onCreate}
          submitting={submitting}
          error={formError}
        />
      ) : null}

      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-ink/40">Loading sessions...</p>
        ) : error ? (
          <div className="bg-white border border-ink/15 rounded-lg p-5">
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={() => void load(page)}
              className="mt-2 text-sm text-accent"
            >
              Retry
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <SessionEmptyState />
        ) : (
          <SessionList sessions={sessions} />
        )}
      </div>

      {!loading && !error && total > PAGE_LIMIT ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        />
      ) : null}
    </div>
  );
}

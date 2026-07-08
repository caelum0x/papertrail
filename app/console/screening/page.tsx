"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchSrProjects, createSrProject } from "./client";
import type { SrProjectWithCounts } from "@/app/api/sr-projects/lib/types";
import { ModuleHeader } from "./_components/ModuleHeader";
import { NewReviewForm } from "./_components/NewReviewForm";
import { ReviewsTable } from "./_components/ReviewsTable";
import { Pagination } from "./_components/Pagination";

const PAGE_SIZE = 20;

export default function ScreeningProjectsPage() {
  const [items, setItems] = useState<SrProjectWithCounts[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [criteria, setCriteria] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchSrProjects(page, PAGE_SIZE);
    if (result.error) {
      setError(result.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(result.data ?? []);
      setTotal(result.total);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = useCallback(async () => {
    setSubmitting(true);
    setFormError(null);
    const inclusionCriteria = criteria
      .split("\n")
      .map((c) => c.trim())
      .filter(Boolean);
    const result = await createSrProject({
      name: name.trim(),
      question: question.trim(),
      inclusionCriteria,
    });
    if (result.error || !result.data) {
      setFormError(result.error ?? "Failed to create review.");
      setSubmitting(false);
      return;
    }
    setName("");
    setQuestion("");
    setCriteria("");
    setShowForm(false);
    setSubmitting(false);
    setPage(1);
    load();
  }, [name, question, criteria, load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canSubmit = name.trim().length > 0 && question.trim().length > 0;

  return (
    <div>
      <ModuleHeader
        title="Systematic Reviews"
        subtitle="Screen literature PRISMA-style: import candidates, triage by title/abstract and full text, and track the flow to inclusion."
        action={
          <button
            onClick={() => setShowForm((s) => !s)}
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
          >
            {showForm ? "Cancel" : "New review"}
          </button>
        }
      />

      {showForm ? (
        <NewReviewForm
          name={name}
          question={question}
          criteria={criteria}
          onNameChange={setName}
          onQuestionChange={setQuestion}
          onCriteriaChange={setCriteria}
          onSubmit={onCreate}
          submitting={submitting}
          canSubmit={canSubmit}
          error={formError}
        />
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-ink/40">
            Loading reviews...
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={load}
              className="mt-3 text-sm text-accent hover:underline"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink/40">
            No systematic reviews yet. Create one to start screening.
          </div>
        ) : (
          <ReviewsTable items={items} />
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

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ApiResponse } from "@/lib/api/response";
import { orgHeaders, type EvalSet, type EvalRun } from "./lib";
import { ModuleHeader } from "./_components/ModuleHeader";
import { AccuracyTrend } from "./_components/AccuracyTrend";
import { NewEvalSetForm } from "./_components/NewEvalSetForm";
import { EvalSetsTable } from "./_components/EvalSetsTable";
import { RecentRunsTable } from "./_components/RecentRunsTable";
import { Pagination } from "./_components/Pagination";

const PAGE_SIZE = 20;

export default function EvaluationPage() {
  const [sets, setSets] = useState<EvalSet[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recentRuns, setRecentRuns] = useState<EvalRun[]>([]);

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    try {
      const [setsRes, runsRes] = await Promise.all([
        fetch(`/api/eval-sets?${params.toString()}`, {
          headers: { ...orgHeaders() },
          cache: "no-store",
        }),
        fetch(`/api/eval-runs?limit=10`, {
          headers: { ...orgHeaders() },
          cache: "no-store",
        }),
      ]);
      const setsBody: ApiResponse<EvalSet[]> = await setsRes.json();
      if (!setsRes.ok || !setsBody.success) {
        setError(setsBody.error ?? "Failed to load eval sets.");
        setSets([]);
        setTotal(0);
      } else {
        setSets(setsBody.data ?? []);
        setTotal(setsBody.meta?.total ?? 0);
      }
      const runsBody: ApiResponse<EvalRun[]> = await runsRes.json();
      if (runsRes.ok && runsBody.success) {
        setRecentRuns(runsBody.data ?? []);
      }
    } catch {
      setError("Network error loading evaluation data.");
      setSets([]);
      setTotal(0);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    setNotice(null);
    if (!newName.trim()) {
      setNotice("Name is required.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/eval-sets", {
        method: "POST",
        headers: { "content-type": "application/json", ...orgHeaders() },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || undefined,
        }),
      });
      const body: ApiResponse<EvalSet> = await res.json();
      if (!res.ok || !body.success) {
        setNotice(body.error ?? "Failed to create eval set.");
      } else {
        setNotice(`Created "${body.data?.name}".`);
        setNewName("");
        setNewDescription("");
        setPage(1);
        await load();
      }
    } catch {
      setNotice("Network error creating eval set.");
    }
    setCreating(false);
  }, [newName, newDescription, load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const completedRuns = recentRuns.filter(
    (r) => r.status === "completed" && r.accuracy !== null
  );

  return (
    <div>
      <ModuleHeader
        title="Evaluation"
        subtitle="Curate labeled eval sets, run them through the verification pipeline, and track accuracy and span grounding over time."
        action={
          <Link
            href="/console/evaluation/runs"
            className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:text-ink/90"
          >
            All runs
          </Link>
        }
      />

      <AccuracyTrend runs={completedRuns} />

      <NewEvalSetForm
        name={newName}
        description={newDescription}
        onNameChange={setNewName}
        onDescriptionChange={setNewDescription}
        onCreate={create}
        creating={creating}
        notice={notice}
      />

      <div className="mt-6 overflow-hidden rounded-lg border border-ink/15 bg-white">
        {loading ? (
          <div className="p-8 text-center text-sm text-ink/40">
            Loading eval sets…
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
        ) : sets.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink/40">
            No eval sets yet. Create one above to start measuring agent quality.
          </div>
        ) : (
          <EvalSetsTable sets={sets} />
        )}
      </div>

      {recentRuns.length > 0 ? <RecentRunsTable runs={recentRuns} /> : null}

      {totalPages > 1 ? (
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

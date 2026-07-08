"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { ApiResponse } from "@/lib/api/response";
import {
  orgHeaders,
  formatPercent,
  type EvalSet,
  type EvalCase,
  type EvalRun,
} from "../lib";
import { AddCaseForm } from "../_components/AddCaseForm";
import { CasesTable } from "../_components/CasesTable";
import { SetRunsTable } from "../_components/SetRunsTable";

export default function EvalSetDetailPage() {
  const params = useParams<{ id: string }>();
  const setId = params?.id;

  const [set, setSet] = useState<EvalSet | null>(null);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [claim, setClaim] = useState("");
  const [sourceExternalId, setSourceExternalId] = useState("");
  const [expectedType, setExpectedType] = useState("accurate");
  const [substrings, setSubstrings] = useState("");
  const [addingCase, setAddingCase] = useState(false);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!setId) return;
    setLoading(true);
    setError(null);
    try {
      const [setRes, casesRes, runsRes] = await Promise.all([
        fetch(`/api/eval-sets/${setId}`, {
          headers: { ...orgHeaders() },
          cache: "no-store",
        }),
        fetch(`/api/eval-sets/${setId}/cases?limit=100`, {
          headers: { ...orgHeaders() },
          cache: "no-store",
        }),
        fetch(`/api/eval-runs?eval_set_id=${setId}&limit=20`, {
          headers: { ...orgHeaders() },
          cache: "no-store",
        }),
      ]);
      const setBody: ApiResponse<EvalSet> = await setRes.json();
      if (!setRes.ok || !setBody.success) {
        setError(setBody.error ?? "Failed to load eval set.");
        setLoading(false);
        return;
      }
      setSet(setBody.data ?? null);

      const casesBody: ApiResponse<EvalCase[]> = await casesRes.json();
      if (casesRes.ok && casesBody.success) setCases(casesBody.data ?? []);

      const runsBody: ApiResponse<EvalRun[]> = await runsRes.json();
      if (runsRes.ok && runsBody.success) setRuns(runsBody.data ?? []);
    } catch {
      setError("Network error loading eval set.");
    }
    setLoading(false);
  }, [setId]);

  useEffect(() => {
    load();
  }, [load]);

  const addCase = useCallback(async () => {
    setNotice(null);
    if (claim.trim().length < 10) {
      setNotice("Claim must be at least 10 characters.");
      return;
    }
    const expectedSubstrings = substrings
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    setAddingCase(true);
    try {
      const res = await fetch(`/api/eval-sets/${setId}/cases`, {
        method: "POST",
        headers: { "content-type": "application/json", ...orgHeaders() },
        body: JSON.stringify({
          claim: claim.trim(),
          source_external_id: sourceExternalId.trim() || undefined,
          expected_discrepancy_type: expectedType,
          expected_substrings: expectedSubstrings.length
            ? expectedSubstrings
            : undefined,
        }),
      });
      const body: ApiResponse<EvalCase> = await res.json();
      if (!res.ok || !body.success) {
        setNotice(body.error ?? "Failed to add case.");
      } else {
        setNotice("Case added.");
        setClaim("");
        setSourceExternalId("");
        setSubstrings("");
        setExpectedType("accurate");
        await load();
      }
    } catch {
      setNotice("Network error adding case.");
    }
    setAddingCase(false);
  }, [claim, sourceExternalId, expectedType, substrings, setId, load]);

  const runSet = useCallback(async () => {
    setNotice(null);
    setRunning(true);
    try {
      const res = await fetch(`/api/eval-runs`, {
        method: "POST",
        headers: { "content-type": "application/json", ...orgHeaders() },
        body: JSON.stringify({ eval_set_id: setId }),
      });
      const body: ApiResponse<EvalRun> = await res.json();
      if (!res.ok || !body.success) {
        setNotice(body.error ?? "Failed to run eval set.");
      } else {
        setNotice(
          `Run ${body.data?.status} — accuracy ${formatPercent(
            body.data?.accuracy
          )}.`
        );
        await load();
      }
    } catch {
      setNotice("Network error running eval set.");
    }
    setRunning(false);
  }, [setId, load]);

  if (loading) {
    return <p className="text-sm text-ink/40">Loading eval set…</p>;
  }
  if (error) {
    return (
      <div>
        <p className="text-sm text-red-700">{error}</p>
        <button onClick={load} className="mt-3 text-sm text-accent hover:underline">
          Try again
        </button>
      </div>
    );
  }
  if (!set) {
    return <p className="text-sm text-ink/40">Eval set not found.</p>;
  }

  return (
    <div>
      <Link
        href="/console/evaluation"
        className="text-sm text-accent hover:underline"
      >
        ← All eval sets
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink/80">{set.name}</h1>
          {set.description ? (
            <p className="mt-1 text-sm text-ink/40">{set.description}</p>
          ) : null}
          <p className="mt-1 text-xs text-ink/40">
            {set.caseCount ?? cases.length} case(s) ·{" "}
            {set.runCount ?? runs.length} run(s)
          </p>
        </div>
        <button
          onClick={runSet}
          disabled={running || cases.length === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          title={cases.length === 0 ? "Add at least one case first" : undefined}
        >
          {running ? "Running…" : "Run eval set"}
        </button>
      </div>

      {notice ? <p className="mt-3 text-sm text-ink/60">{notice}</p> : null}

      <AddCaseForm
        claim={claim}
        sourceExternalId={sourceExternalId}
        expectedType={expectedType}
        substrings={substrings}
        onClaimChange={setClaim}
        onSourceChange={setSourceExternalId}
        onExpectedTypeChange={setExpectedType}
        onSubstringsChange={setSubstrings}
        onAdd={addCase}
        adding={addingCase}
      />

      <CasesTable cases={cases} />

      <SetRunsTable runs={runs} />
    </div>
  );
}

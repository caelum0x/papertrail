"use client";

import { useCallback, useMemo, useState } from "react";

// Advanced meta-analysis console — Bayesian posterior/predictive + leave-one-out
// sensitivity, over the deterministic /api/meta/bayesian and /api/meta/sensitivity
// endpoints (no LLM in the numeric path). Public routes, so no org header is sent.

interface StudyRow {
  label: string;
  point: string;
  ciLower: string;
  ciUpper: string;
}

const MEASURES = ["RR", "HR", "OR"] as const;
type Measure = (typeof MEASURES)[number];

const EXAMPLE: StudyRow[] = [
  { label: "Trial A", point: "0.72", ciLower: "0.60", ciUpper: "0.86" },
  { label: "Trial B", point: "0.68", ciLower: "0.51", ciUpper: "0.90" },
  { label: "Trial C", point: "0.80", ciLower: "0.70", ciUpper: "0.92" },
];

function toStudies(rows: StudyRow[], measure: Measure) {
  return rows
    .filter((r) => r.point.trim() && r.ciLower.trim() && r.ciUpper.trim())
    .map((r) => ({
      label: r.label.trim() || "study",
      measure,
      point: Number(r.point),
      ci_lower: Number(r.ciLower),
      ci_upper: Number(r.ciUpper),
    }));
}

export default function MetaAdvancedPage() {
  const [rows, setRows] = useState<StudyRow[]>(EXAMPLE);
  const [measure, setMeasure] = useState<Measure>("RR");
  const [bayes, setBayes] = useState<unknown>(null);
  const [sens, setSens] = useState<unknown>(null);
  const [loading, setLoading] = useState<"bayes" | "sens" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const studies = useMemo(() => toStudies(rows, measure), [rows, measure]);

  const setRow = useCallback((i: number, patch: Partial<StudyRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }, []);

  const run = useCallback(
    async (which: "bayes" | "sens") => {
      setLoading(which);
      setError(null);
      try {
        const path = which === "bayes" ? "/api/meta/bayesian" : "/api/meta/sensitivity";
        const res = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ studies }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) {
          setError(body?.error ?? "Request failed.");
          return;
        }
        if (which === "bayes") setBayes(body.data);
        else setSens(body.data);
      } catch {
        setError("Couldn't reach the server. Try again.");
      } finally {
        setLoading(null);
      }
    },
    [studies]
  );

  return (
    <main className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-ink/80">Advanced meta-analysis</h1>
        <p className="mt-1 text-sm text-ink/50">
          Bayesian posterior + posterior-predictive interval and leave-one-out sensitivity —
          deterministic, no LLM in the numeric path.
        </p>
      </header>

      <section className="rounded-xl border border-ink/15 bg-white p-5">
        <div className="mb-3 flex items-center gap-3">
          <label className="text-sm text-ink/70">Effect measure</label>
          <select
            value={measure}
            onChange={(e) => setMeasure(e.target.value as Measure)}
            className="rounded border border-ink/15 px-2 py-1 text-sm focus:border-accent focus:outline-none"
          >
            {MEASURES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink/40">{studies.length} usable studies</span>
        </div>

        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 text-xs font-medium text-ink/40">
          <span>Label</span>
          <span>Point</span>
          <span>CI lower</span>
          <span>CI upper</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="mt-2 grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2">
            {(["label", "point", "ciLower", "ciUpper"] as const).map((f) => (
              <input
                key={f}
                value={r[f]}
                onChange={(e) => setRow(i, { [f]: e.target.value })}
                className="rounded border border-ink/15 px-2 py-1 text-sm focus:border-accent focus:outline-none"
              />
            ))}
          </div>
        ))}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setRows((p) => [...p, { label: "", point: "", ciLower: "", ciUpper: "" }])}
            className="rounded border border-ink/20 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
          >
            Add study
          </button>
          <button
            onClick={() => run("bayes")}
            disabled={loading !== null || studies.length < 2}
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {loading === "bayes" ? "Running…" : "Bayesian"}
          </button>
          <button
            onClick={() => run("sens")}
            disabled={loading !== null || studies.length < 3}
            className="rounded border border-accent px-4 py-1.5 text-sm font-medium text-accent disabled:opacity-40"
          >
            {loading === "sens" ? "Running…" : "Leave-one-out"}
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
      </section>

      {bayes ? (
        <section className="mt-6 rounded-xl border border-ink/15 bg-white p-5">
          <h2 className="text-base font-semibold text-ink">Bayesian random-effects</h2>
          <pre className="mt-3 overflow-x-auto rounded bg-ink/5 p-3 text-xs text-ink/80">
            {JSON.stringify(bayes, null, 2)}
          </pre>
        </section>
      ) : null}

      {sens ? (
        <section className="mt-6 rounded-xl border border-ink/15 bg-white p-5">
          <h2 className="text-base font-semibold text-ink">Leave-one-out sensitivity</h2>
          <pre className="mt-3 overflow-x-auto rounded bg-ink/5 p-3 text-xs text-ink/80">
            {JSON.stringify(sens, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}

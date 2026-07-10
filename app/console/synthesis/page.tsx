"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ForestPlot, type ForestStudy } from "@/components/synthesis/ForestPlot";
import { StudyEditor, type StudyEditorLayout } from "@/components/synthesis/StudyEditor";
import { VerdictBanner } from "./_components/VerdictBanner";
import { PooledStats } from "./_components/PooledStats";
import type { StudyForm, SynthesisResponse } from "./_components/types";

// Evidence-synthesis console: enter N study effect estimates and a claim, pool
// them via the deterministic /api/synthesis engine, and see the verdict, pooled
// estimates, heterogeneity, prediction interval, and a forest plot. No LLM here.

let rowSeq = 0;
function newRow(): StudyForm {
  rowSeq += 1;
  return { id: `s${rowSeq}`, label: "", measure: "HR", point: "", ciLower: "", ciUpper: "", ciPct: "95" };
}

const SEED: StudyForm[] = [
  { id: "seed-1", label: "TrialA", measure: "HR", point: "0.75", ciLower: "0.60", ciUpper: "0.94", ciPct: "95" },
  { id: "seed-2", label: "TrialB", measure: "HR", point: "0.82", ciLower: "0.68", ciUpper: "0.99", ciPct: "95" },
];

// Grid geometry for this console's study editor — matches the original inline
// layout exactly (framed rows with a CI% column and a text "Remove" button).
const EDITOR_LAYOUT: StudyEditorLayout = {
  variant: "framed",
  headers: { ciLower: "CI lower", ciUpper: "CI upper" },
  columns: {
    label: { row: "col-span-12 sm:col-span-3" },
    measure: { row: "col-span-3 sm:col-span-1", header: "sm:col-span-1" },
    point: { row: "col-span-3 sm:col-span-2", header: "sm:col-span-2" },
    ciLower: { row: "col-span-3 sm:col-span-2", header: "sm:col-span-2" },
    ciUpper: { row: "col-span-3 sm:col-span-2", header: "sm:col-span-2" },
    ciPct: { row: "col-span-8 sm:col-span-1", header: "sm:col-span-1" },
    remove: { row: "col-span-4 sm:col-span-1", header: "sm:col-span-1" },
  },
};

function parseNum(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// Build the request payload, mapping form strings to the snake_case study shape
// the SynthesisRequestSchema expects. Returns a client-side error string instead
// when a row is incomplete, so we fail fast before hitting the network.
function buildPayload(
  claim: string,
  rows: readonly StudyForm[]
): { payload: { claim: string; studies: unknown[] } } | { error: string } {
  if (claim.trim().length < 10) {
    return { error: "Enter a claim of at least 10 characters." };
  }
  const studies: unknown[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const point = parseNum(r.point);
    const ciLower = parseNum(r.ciLower);
    const ciUpper = parseNum(r.ciUpper);
    if (point === undefined || ciLower === undefined || ciUpper === undefined) {
      return { error: `Study ${i + 1} needs a point estimate and both CI bounds.` };
    }
    if (!(point > 0 && ciLower > 0 && ciUpper > 0)) {
      return { error: `Study ${i + 1}: point and CI values must be positive ratios.` };
    }
    if (ciUpper <= ciLower) {
      return { error: `Study ${i + 1}: CI upper must exceed CI lower.` };
    }
    studies.push({
      label: r.label.trim() || `Trial ${i + 1}`,
      measure: r.measure,
      point,
      ci_lower: ciLower,
      ci_upper: ciUpper,
      ci_pct: parseNum(r.ciPct) ?? 95,
    });
  }
  if (studies.length < 2) {
    return { error: "Add at least two studies to pool." };
  }
  return { payload: { claim: claim.trim(), studies } };
}

export default function SynthesisPage() {
  const [claim, setClaim] = useState("");
  const [rows, setRows] = useState<StudyForm[]>(SEED);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SynthesisResponse | null>(null);

  const updateRow = useCallback((next: StudyForm) => {
    setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)));
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => (prev.length <= 2 ? prev : prev.filter((r) => r.id !== id)));
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => (prev.length >= 100 ? prev : [...prev, newRow()]));
  }, []);

  const submit = useCallback(async () => {
    const built = buildPayload(claim, rows);
    if ("error" in built) {
      setError(built.error);
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.payload),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<SynthesisResponse> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Synthesis failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run synthesis.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [claim, rows]);

  const forestStudies = useMemo<ForestStudy[]>(() => {
    if (!result?.pooled) return [];
    return result.pooled.studies.map((s) => ({
      label: s.label,
      point: s.point,
      ciLower: s.ciLower,
      ciUpper: s.ciUpper,
      weightPct: s.weightRandomPct,
    }));
  }, [result]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Evidence synthesis"
        subtitle="Pool registered effect estimates across trials and check a claim against the totality of evidence — deterministically."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <label className="block text-sm font-medium text-ink/70" htmlFor="claim">
          Claim
        </label>
        <textarea
          id="claim"
          rows={2}
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="e.g. Drug X cuts major cardiovascular events by 30% across trials."
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <StudyEditor
          studies={rows}
          layout={EDITOR_LAYOUT}
          onChange={updateRow}
          onRemove={removeRow}
        />

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= 100}
            className="text-sm font-medium text-accent hover:underline disabled:opacity-40"
          >
            + Add study
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Pooling…" : "Run synthesis"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Pooling studies…
        </div>
      ) : result ? (
        <div className="space-y-6">
          <VerdictBanner verdict={result.verdict} />

          {result.pooled ? (
            <>
              <div className="rounded-lg border border-ink/15 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink/70">Pooled estimates</h3>
                <PooledStats pooled={result.pooled} />
              </div>

              <div className="rounded-lg border border-ink/15 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-ink/70">Forest plot</h3>
                <ForestPlot
                  measure={result.pooled.measure}
                  studies={forestStudies}
                  pooled={{
                    label: "Pooled (random)",
                    point: result.pooled.random.point,
                    ciLower: result.pooled.random.ciLower,
                    ciUpper: result.pooled.random.ciUpper,
                  }}
                  predictionInterval={result.pooled.predictionInterval}
                />
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ForestPlot, type ForestStudy } from "@/components/synthesis/ForestPlot";
import { StudyEditor, type StudyEditorLayout } from "@/components/synthesis/StudyEditor";
import { ReportSummary } from "./_components/ReportSummary";
import { PooledPanel } from "./_components/PooledPanel";
import { BiasPanel } from "./_components/BiasPanel";
import type { BuildEvidenceReportResult, StudyForm } from "./_components/types";
import { formatAbsolute } from "@/lib/absoluteEffects";

// Composite EVIDENCE-REPORT console: enter a claim and N trial effect estimates,
// POST to the deterministic /api/evidence-report engine, and see the GRADE
// certainty badge, the synthesis verdict, pooled fixed + random stats, the
// publication-bias (Egger's) result, and a forest plot. No LLM in this path.

let rowSeq = 0;
function newRow(): StudyForm {
  rowSeq += 1;
  return { id: `s${rowSeq}`, label: "", measure: "HR", point: "", ciLower: "", ciUpper: "", ciPct: "95" };
}

// Three seed studies so the plot, Egger's test (needs k>=3), and GRADE all render
// on first load — a working demo the moment the page opens.
const SEED: StudyForm[] = [
  { id: "seed-1", label: "SPRINT", measure: "HR", point: "0.75", ciLower: "0.64", ciUpper: "0.89", ciPct: "95" },
  { id: "seed-2", label: "ACCORD", measure: "HR", point: "0.88", ciLower: "0.74", ciUpper: "1.05", ciPct: "95" },
  { id: "seed-3", label: "HOPE-3", measure: "HR", point: "0.80", ciLower: "0.68", ciUpper: "0.95", ciPct: "95" },
];

// Grid geometry for this console's study editor — matches the original inline
// layout exactly (compact rows with a CI% column and a "×" remove button).
const EDITOR_LAYOUT: StudyEditorLayout = {
  variant: "compact",
  headers: { ciLower: "CI lower", ciUpper: "CI upper" },
  columns: {
    label: { row: "col-span-12 sm:col-span-3" },
    measure: { row: "col-span-3 sm:col-span-1", header: "sm:col-span-1" },
    point: { row: "col-span-3 sm:col-span-2", header: "sm:col-span-2" },
    ciLower: { row: "col-span-3 sm:col-span-2", header: "sm:col-span-2" },
    ciUpper: { row: "col-span-3 sm:col-span-2", header: "sm:col-span-2" },
    ciPct: { row: "col-span-2 sm:col-span-1", header: "sm:col-span-1" },
    remove: { row: "col-span-1", header: "sm:col-span-1" },
  },
};

function parseNum(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// Build the request payload, mapping form strings to the snake_case study shape
// the EvidenceReportRequestSchema expects. Returns a client-side error string
// instead when a row is incomplete, so we fail fast before hitting the network.
function buildPayload(
  claim: string,
  rows: readonly StudyForm[],
  baselineRiskInput: string
): { payload: { claim: string; studies: unknown[]; baselineRisk?: number } } | { error: string } {
  if (claim.trim().length < 10) {
    return { error: "Enter a claim of at least 10 characters." };
  }
  let baselineRisk: number | undefined;
  if (baselineRiskInput.trim() !== "") {
    const b = parseNum(baselineRiskInput);
    if (b === undefined || !(b > 0 && b < 1)) {
      return { error: "Baseline risk must be a number strictly between 0 and 1 (e.g. 0.1)." };
    }
    baselineRisk = b;
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
    return { error: "Add at least two studies to build a report." };
  }
  return {
    payload: {
      claim: claim.trim(),
      studies,
      ...(baselineRisk !== undefined ? { baselineRisk } : {}),
    },
  };
}

export default function EvidenceReportPage() {
  const [claim, setClaim] = useState(
    "Intensive blood-pressure control cuts major cardiovascular events by about 25%."
  );
  const [rows, setRows] = useState<StudyForm[]>(SEED);
  const [baselineRisk, setBaselineRisk] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuildEvidenceReportResult | null>(null);

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
    const built = buildPayload(claim, rows, baselineRisk);
    if ("error" in built) {
      setError(built.error);
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/evidence-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(built.payload),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<BuildEvidenceReportResult> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Evidence report failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build evidence report.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [claim, rows, baselineRisk]);

  const forestStudies = useMemo<ForestStudy[]>(() => {
    if (!result || !result.ok) return [];
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
        title="Evidence report"
        subtitle="Pool trials, test for publication bias, rate GRADE certainty, and reconcile a claim — one defensible report, no LLM in the numeric loop."
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

        <div className="mt-4">
          <label className="block text-sm font-medium text-ink/70" htmlFor="baselineRisk">
            Baseline (control-arm) risk <span className="text-ink/40">— optional, for absolute effects</span>
          </label>
          <input
            id="baselineRisk"
            type="text"
            inputMode="decimal"
            value={baselineRisk}
            onChange={(e) => setBaselineRisk(e.target.value)}
            placeholder="e.g. 0.10 (10% event rate in controls)"
            className="mt-1 w-full max-w-xs rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-ink/40">
            A number strictly between 0 and 1. When set, the report adds ARR, NNT, and events-per-1000 from the pooled random-effects estimate.
          </p>
        </div>

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
            {loading ? "Building…" : "Build evidence report"}
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
          Building evidence report…
        </div>
      ) : result && !result.ok ? (
        <div className="rounded-lg border border-ink/15 bg-white p-5">
          <h3 className="text-sm font-semibold text-ink/70">Insufficient evidence</h3>
          <p className="mt-2 text-sm text-ink/60">{result.reason}</p>
        </div>
      ) : result && result.ok ? (
        <div className="space-y-6">
          <ReportSummary report={result} />

          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink/70">Pooled estimates</h3>
            <PooledPanel pooled={result.pooled} />
          </div>

          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink/70">Publication bias (Egger&apos;s test)</h3>
            <BiasPanel bias={result.publicationBias} />
          </div>

          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink/70">GRADE rationale</h3>
            <p className="text-sm text-ink/60">{result.certainty.rationale}</p>
            {result.certainty.downgrades.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-xs text-ink/50">
                {result.certainty.downgrades.map((d, i) => (
                  <li key={`${d.domain}-${i}`}>
                    <span className="font-medium text-ink/70">
                      {d.domain} (−{d.steps})
                    </span>
                    : {d.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {result.absoluteEffects ? (
            <div className="rounded-lg border border-ink/15 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink/70">
                Absolute effects
                <span className="ml-2 font-normal text-ink/40">
                  at {Math.round(result.absoluteEffects.riskControl * 1000)} events / 1000 baseline risk
                </span>
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink/40">Absolute risk reduction</div>
                  <div className="mt-1 text-lg font-semibold text-ink/80">
                    {(result.absoluteEffects.absoluteRiskReduction * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-ink/40">
                    95% CI {(result.absoluteEffects.arrCiLower * 100).toFixed(1)}% – {(result.absoluteEffects.arrCiUpper * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink/40">
                    {result.absoluteEffects.direction === "harm" ? "NNH (number needed to harm)" : "NNT (number needed to treat)"}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-ink/80">
                    {Number.isFinite(result.absoluteEffects.nnt)
                      ? Math.abs(Math.round(result.absoluteEffects.nnt))
                      : "∞"}
                  </div>
                  <div className="text-xs text-ink/40">
                    {Number.isFinite(result.absoluteEffects.nntCiLower) && Number.isFinite(result.absoluteEffects.nntCiUpper)
                      ? `95% CI ${Math.abs(Math.round(result.absoluteEffects.nntCiLower))} – ${Math.abs(Math.round(result.absoluteEffects.nntCiUpper))}`
                      : "CI includes no effect"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink/40">Events per 1000</div>
                  <div className="mt-1 text-lg font-semibold text-ink/80">
                    {result.absoluteEffects.eventsPer1000Treated} treated vs {result.absoluteEffects.eventsPer1000Control} control
                  </div>
                  <div className="text-xs text-ink/40">
                    {result.absoluteEffects.direction === "harm" ? "more" : "fewer"} events with treatment
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm text-ink/60">{formatAbsolute(result.absoluteEffects)}</p>
            </div>
          ) : null}

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
        </div>
      ) : null}
    </div>
  );
}

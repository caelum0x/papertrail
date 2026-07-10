"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { StudyEditor, type StudyEditorLayout } from "@/components/synthesis/StudyEditor";
import { ExportButton } from "./_components/ExportButton";
import { buildPayload } from "./_components/payload";
import { CachedSourceLoader, type LoadedSkip } from "./_components/CachedSourceLoader";
import { SourcePickerLoader } from "./_components/SourcePickerLoader";
import { RiskOfBiasPanel } from "./_components/RiskOfBiasPanel";
import { EvidenceReportView } from "./_components/EvidenceReportView";
import { AutoFindPanel } from "./_components/AutoFindPanel";
import type { EvidenceReportResult, StudyForm } from "./_components/types";

// Four ways to assemble the study set: let PaperTrail auto-find & synthesise its own
// primary sources from a claim, type effect estimates by hand, pick cached sources from
// the searchable catalogue (auto-synthesis), or paste raw source ids.
type InputMode = "auto" | "manual" | "pick" | "paste";

// EVIDENCE WORKBENCH — one console screen where a reviewer enters a claim + a set
// of trials and sees the WHOLE deterministic stack at once: meta-analysis pooled
// estimate, GRADE certainty, publication-bias (Egger), synthesis verdict, and
// absolute effects. It POSTs to the existing /api/evidence-report endpoint and only
// renders what the engines produced — NO LLM anywhere in this path.

let rowSeq = 0;
function newRow(): StudyForm {
  rowSeq += 1;
  return { id: `s${rowSeq}`, label: "", measure: "HR", point: "", ciLower: "", ciUpper: "" };
}

const SEED: StudyForm[] = [
  { id: "seed-1", label: "TrialA", measure: "HR", point: "0.75", ciLower: "0.60", ciUpper: "0.94" },
  { id: "seed-2", label: "TrialB", measure: "HR", point: "0.82", ciLower: "0.68", ciUpper: "0.99" },
  { id: "seed-3", label: "TrialC", measure: "HR", point: "0.79", ciLower: "0.63", ciUpper: "0.98" },
];

// Grid geometry for this console's study editor — matches the original inline
// layout exactly (framed rows, no CI% column, "CI lo"/"CI hi" headers, and a text
// "Remove" button).
const EDITOR_LAYOUT: StudyEditorLayout = {
  variant: "framed",
  headers: { ciLower: "CI lo", ciUpper: "CI hi" },
  columns: {
    label: { row: "col-span-12 sm:col-span-4" },
    measure: { row: "col-span-3 sm:col-span-2", header: "sm:col-span-2" },
    point: { row: "col-span-3 sm:col-span-2", header: "sm:col-span-2" },
    ciLower: { row: "col-span-3 sm:col-span-1", header: "sm:col-span-1" },
    ciUpper: { row: "col-span-3 sm:col-span-2", header: "sm:col-span-2" },
    remove: { row: "col-span-12 sm:col-span-1", header: "sm:col-span-1" },
  },
};

export default function WorkbenchPage() {
  const [claim, setClaim] = useState("");
  const [rows, setRows] = useState<StudyForm[]>(SEED);
  const [baselineRisk, setBaselineRisk] = useState("");
  // GRADE risk-of-bias downgrade (0/1/2) derived by the RoB panel from the
  // deterministic engine. null = not assessed → omitted from the request.
  const [riskOfBiasSteps, setRiskOfBiasSteps] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<EvidenceReportResult | null>(null);
  const [mode, setMode] = useState<InputMode>("manual");

  // When the cached-source loader extracts studies, lift them into the form rows so
  // the rest of the deterministic stack (run/export/save) treats them identically to
  // hand-entered studies. Skip reasons are surfaced by the loader itself.
  const handleLoadedFromCache = useCallback((loaded: StudyForm[], _skips: LoadedSkip[]) => {
    if (loaded.length > 0) {
      setRows(loaded);
    }
  }, []);

  const updateRow = useCallback((next: StudyForm) => {
    setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)));
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => (prev.length <= 2 ? prev : prev.filter((r) => r.id !== id)));
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => (prev.length >= 100 ? prev : [...prev, newRow()]));
  }, []);

  // Shared builder used by both the run action and the export button so they always
  // send identical inputs (export drops baselineRisk itself — it is not exported).
  // riskOfBiasSteps is forwarded as the request's risk_of_bias_steps when assessed.
  const build = useCallback(
    () => buildPayload(claim, rows, baselineRisk, riskOfBiasSteps ?? undefined),
    [claim, rows, baselineRisk, riskOfBiasSteps]
  );

  const submit = useCallback(async () => {
    const built = build();
    if ("error" in built) {
      setError(built.error);
      setReport(null);
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
      const body = (await res.json().catch(() => null)) as ApiResponse<EvidenceReportResult> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Evidence report failed.");
      }
      setReport(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build evidence report.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [build]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Evidence Workbench"
        subtitle="Enter a claim and a set of trials, then see the whole deterministic stack at once — pooled estimate, GRADE certainty, publication bias, synthesis verdict, and absolute effects."
        action={<ExportButton buildPayload={build} />}
      />

      <div className="inline-flex rounded-md border border-ink/15 p-0.5" role="tablist" aria-label="Study input mode">
        {(["auto", "manual", "pick", "paste"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition ${
              mode === m ? "bg-accent text-white" : "text-ink/60 hover:text-ink"
            }`}
          >
            {m === "auto"
              ? "Auto-find & synthesize"
              : m === "manual"
                ? "Manual entry"
                : m === "pick"
                  ? "Pick cached sources"
                  : "Paste source ids"}
          </button>
        ))}
      </div>

      {mode === "auto" ? <AutoFindPanel /> : null}

      {mode !== "auto" ? (
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

        {mode === "pick" ? (
          <SourcePickerLoader claim={claim} onLoaded={handleLoadedFromCache} />
        ) : null}
        {mode === "paste" ? (
          <CachedSourceLoader claim={claim} onLoaded={handleLoadedFromCache} />
        ) : null}

        <StudyEditor
          studies={rows}
          layout={EDITOR_LAYOUT}
          onChange={updateRow}
          onRemove={removeRow}
        />

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-ink/40" htmlFor="baseline">
              Baseline risk (optional)
            </label>
            <input
              id="baseline"
              inputMode="decimal"
              value={baselineRisk}
              onChange={(e) => setBaselineRisk(e.target.value)}
              placeholder="0.12"
              className="mt-1 w-32 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-ink/40">Control-arm risk in (0, 1) → absolute effects</p>
          </div>
        </div>

        <RiskOfBiasPanel onStepsChange={setRiskOfBiasSteps} />

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
            {loading ? "Analyzing…" : "Run workbench"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      ) : null}

      {mode !== "auto" ? (
        loading ? (
          <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
            Running the deterministic stack…
          </div>
        ) : report ? (
          <EvidenceReportView report={report} />
        ) : null
      ) : null}
    </div>
  );
}

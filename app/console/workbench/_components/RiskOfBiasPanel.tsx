"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";

// RISK-OF-BIAS PANEL — surfaces the deterministic risk-of-bias engine in the
// Evidence Workbench. The reviewer answers a compact set of reviewer-answerable
// Cochrane RoB-2 style questions about the body of evidence; this POSTs them to
// /api/risk-of-bias, which returns the per-domain judgements, an overall
// judgement, and a GRADE downgrade step count (0/1/2). That step count is lifted
// back into the workbench and fed into /api/evidence-report as risk_of_bias_steps,
// so GRADE certainty reflects study-level appraisal — the one domain the numeric
// layer cannot invent. NO LLM is in this path: every judgement is a pure rule.

// Minimal wire shapes we consume from /api/risk-of-bias (mirrors RiskOfBiasResult
// in lib/riskOfBias). Kept local so this component never imports server code.
type RobJudgement = "low" | "some_concerns" | "high";

interface RobDomainWire {
  name: string;
  judgement: RobJudgement;
  reason: string;
}

interface RiskOfBiasWire {
  domains: RobDomainWire[];
  overall: RobJudgement;
  gradeSteps: number;
}

export interface RiskOfBiasPanelProps {
  // Reports the derived GRADE step count (0/1/2) up to the workbench, or null when
  // the reviewer has not run/kept an assessment (so it is omitted from the request).
  onStepsChange: (steps: number | null) => void;
}

// The reviewer-answerable form. Booleans default to the "clean trial" answers so an
// unassessed body of evidence starts at zero downgrade; the reviewer relaxes them.
interface RobForm {
  randomSequenceGenerated: boolean;
  allocationConcealed: boolean;
  blinding: "double_blind" | "single_blind" | "open_label" | "unclear";
  outcomeAssessorBlinded: boolean;
  outcomeType: "objective" | "subjective";
  attritionRate: string; // 0..1, kept as string while editing
  intentionToTreat: boolean;
  preRegistered: boolean;
  allPrespecifiedOutcomesReported: boolean;
}

const DEFAULT_FORM: RobForm = {
  randomSequenceGenerated: true,
  allocationConcealed: true,
  blinding: "double_blind",
  outcomeAssessorBlinded: true,
  outcomeType: "objective",
  attritionRate: "0.03",
  intentionToTreat: true,
  preRegistered: true,
  allPrespecifiedOutcomesReported: true,
};

function judgementClasses(j: RobJudgement): string {
  if (j === "high") return "bg-red-50 text-red-700 border-red-200";
  if (j === "some_concerns") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function prettyJudgement(j: RobJudgement): string {
  return j.replace("_", " ");
}

function prettyDomain(name: string): string {
  return name.replace(/_/g, " ");
}

export function RiskOfBiasPanel({ onStepsChange }: RiskOfBiasPanelProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RobForm>(DEFAULT_FORM);
  const [result, setResult] = useState<RiskOfBiasWire | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(<K extends keyof RobForm>(key: K, value: RobForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const assess = useCallback(async () => {
    setError(null);
    const attrition = Number(form.attritionRate.trim());
    if (!Number.isFinite(attrition) || attrition < 0 || attrition > 1) {
      setError("Attrition rate must be a proportion between 0 and 1 (e.g. 0.08).");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/risk-of-bias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          randomSequenceGenerated: form.randomSequenceGenerated,
          allocationConcealed: form.allocationConcealed,
          blinding: form.blinding,
          outcomeAssessorBlinded: form.outcomeAssessorBlinded,
          outcomeType: form.outcomeType,
          attritionRate: attrition,
          intentionToTreat: form.intentionToTreat,
          preRegistered: form.preRegistered,
          allPrespecifiedOutcomesReported: form.allPrespecifiedOutcomesReported,
        }),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<RiskOfBiasWire> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Risk-of-bias assessment failed.");
      }
      setResult(body.data);
      onStepsChange(body.data.gradeSteps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assess risk of bias.");
    } finally {
      setLoading(false);
    }
  }, [form, onStepsChange]);

  const clear = useCallback(() => {
    setResult(null);
    setError(null);
    onStepsChange(null);
  }, [onStepsChange]);

  return (
    <div className="mt-4 rounded-md border border-ink/10 bg-paper/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-sm font-medium text-ink/70">
          Risk of bias (optional GRADE downgrade)
        </span>
        <span className="flex items-center gap-2">
          {result ? (
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${judgementClasses(
                result.overall
              )}`}
            >
              {prettyJudgement(result.overall)} · −{result.gradeSteps}
            </span>
          ) : null}
          <span className="text-xs text-ink/40">{open ? "Hide" : "Assess"}</span>
        </span>
      </button>

      {open ? (
        <div className="space-y-3 border-t border-ink/10 px-3 py-3">
          <p className="text-xs text-ink/40">
            Answer for the body of evidence (or its weakest contributing trial). The
            deterministic engine reduces these to a GRADE risk-of-bias downgrade
            (0/1/2) that feeds the certainty rating — no LLM, every judgement a rule.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={form.randomSequenceGenerated}
                onChange={(e) => set("randomSequenceGenerated", e.target.checked)}
                className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
              />
              Random sequence generated
            </label>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={form.allocationConcealed}
                onChange={(e) => set("allocationConcealed", e.target.checked)}
                className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
              />
              Allocation concealed
            </label>

            <label className="flex flex-col gap-1 text-sm text-ink/70">
              Blinding
              <select
                value={form.blinding}
                onChange={(e) => set("blinding", e.target.value as RobForm["blinding"])}
                className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              >
                <option value="double_blind">Double-blind</option>
                <option value="single_blind">Single-blind</option>
                <option value="open_label">Open-label</option>
                <option value="unclear">Unclear</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm text-ink/70">
              Primary outcome
              <select
                value={form.outcomeType}
                onChange={(e) => set("outcomeType", e.target.value as RobForm["outcomeType"])}
                className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              >
                <option value="objective">Objective (e.g. mortality)</option>
                <option value="subjective">Subjective (rated)</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={form.outcomeAssessorBlinded}
                onChange={(e) => set("outcomeAssessorBlinded", e.target.checked)}
                className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
              />
              Outcome assessor blinded
            </label>

            <label className="flex flex-col gap-1 text-sm text-ink/70">
              Attrition rate (0–1)
              <input
                inputMode="decimal"
                value={form.attritionRate}
                onChange={(e) => set("attritionRate", e.target.value)}
                placeholder="0.08"
                className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={form.intentionToTreat}
                onChange={(e) => set("intentionToTreat", e.target.checked)}
                className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
              />
              Intention-to-treat analysis
            </label>

            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={form.preRegistered}
                onChange={(e) => set("preRegistered", e.target.checked)}
                className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
              />
              Pre-registered
            </label>

            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input
                type="checkbox"
                checked={form.allPrespecifiedOutcomesReported}
                onChange={(e) => set("allPrespecifiedOutcomesReported", e.target.checked)}
                className="h-4 w-4 rounded border-ink/30 text-accent focus:ring-accent"
              />
              All pre-specified outcomes reported
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void assess()}
              disabled={loading}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Assessing…" : "Assess & apply"}
            </button>
            {result ? (
              <button
                type="button"
                onClick={clear}
                className="text-xs text-ink/40 underline underline-offset-2 hover:text-ink/70"
              >
                Clear (don&apos;t downgrade)
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          {result ? (
            <div className="space-y-2">
              <p className="text-sm text-ink/70">
                Overall risk of bias:{" "}
                <span className="font-medium">{prettyJudgement(result.overall)}</span> ·
                applies a{" "}
                <span className="font-medium">{result.gradeSteps}-step</span> GRADE
                downgrade for risk of bias, now included in the report.
              </p>
              <ul className="space-y-1">
                {result.domains.map((d) => (
                  <li key={d.name} className="flex items-start gap-2 text-xs text-ink/60">
                    <span
                      className={`mt-0.5 inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-medium ${judgementClasses(
                        d.judgement
                      )}`}
                    >
                      {prettyJudgement(d.judgement)}
                    </span>
                    <span>
                      <span className="font-medium text-ink/70">{prettyDomain(d.name)}:</span>{" "}
                      {d.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

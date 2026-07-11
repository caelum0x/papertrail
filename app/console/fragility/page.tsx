"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { LoadingBanner } from "@/components/console/StateBanners";
import { ResultView } from "./_components/ResultView";
import type { FragilityResult, StudyRow } from "./_components/types";

// Verdict-fragility console: how robust is a pooled verdict? Enter a single 2x2
// table for the Walsh Fragility Index (how many event reassignments flip
// significance), or a set of studies for leave-one-out meta robustness plus an
// information-size check. Every number is computed deterministically by
// /api/evidence/fragility — no LLM anywhere in the scoring path.

type Mode = "table" | "meta";

const EMPTY_STUDY: StudyRow = { label: "", events1: "", total1: "", events2: "", total2: "" };

function toIntOrNull(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

export default function FragilityPage() {
  const [mode, setMode] = useState<Mode>("table");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FragilityResult | null>(null);

  // 2x2 table inputs.
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [d, setD] = useState("");

  // Meta inputs.
  const [studies, setStudies] = useState<StudyRow[]>([{ ...EMPTY_STUDY }, { ...EMPTY_STUDY }]);
  const [useInfoSize, setUseInfoSize] = useState(false);
  const [controlRisk, setControlRisk] = useState("0.1");
  const [rrr, setRrr] = useState("0.25");

  const run = useCallback(
    async (payload: unknown) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/evidence/fragility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => null)) as ApiResponse<FragilityResult> | null;
        if (!body) throw new Error("Unexpected server response.");
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? "Fragility analysis failed.");
        }
        setResult(body.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to run fragility analysis.");
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const submitTable = useCallback(() => {
    const cells = { a: toIntOrNull(a), b: toIntOrNull(b), c: toIntOrNull(c), d: toIntOrNull(d) };
    if (Object.values(cells).some((v) => v === null || Number.isNaN(v))) {
      setError("Enter all four cells as non-negative integers.");
      setResult(null);
      return;
    }
    void run({ mode: "table", ...cells });
  }, [a, b, c, d, run]);

  const submitMeta = useCallback(() => {
    const rows = studies
      .map((s) => ({
        label: s.label.trim(),
        measure: "RR" as const,
        events1: toIntOrNull(s.events1),
        total1: toIntOrNull(s.total1),
        events2: toIntOrNull(s.events2),
        total2: toIntOrNull(s.total2),
      }))
      .filter((s) => s.label.length > 0);

    if (rows.length < 2) {
      setError("Enter at least two studies (each with a label).");
      setResult(null);
      return;
    }
    if (
      rows.some(
        (s) =>
          Number.isNaN(s.events1) ||
          Number.isNaN(s.total1) ||
          Number.isNaN(s.events2) ||
          Number.isNaN(s.total2) ||
          s.events1 === null ||
          s.total1 === null ||
          s.events2 === null ||
          s.total2 === null ||
          s.total1 <= 0 ||
          s.total2 <= 0
      )
    ) {
      setError("Every study needs events and positive totals for both arms.");
      setResult(null);
      return;
    }

    const payload: {
      mode: "meta";
      studies: typeof rows;
      informationSize?: { controlRisk: number; relativeRiskReduction: number };
    } = { mode: "meta", studies: rows };

    if (useInfoSize) {
      const cr = Number(controlRisk);
      const r = Number(rrr);
      if (!(cr > 0 && cr < 1) || !(r > 0 && r < 1)) {
        setError("Control risk and RRR must each be between 0 and 1.");
        setResult(null);
        return;
      }
      payload.informationSize = { controlRisk: cr, relativeRiskReduction: r };
    }

    void run(payload);
  }, [studies, useInfoSize, controlRisk, rrr, run]);

  const updateStudy = useCallback((index: number, patch: Partial<StudyRow>) => {
    setStudies((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }, []);

  const addStudy = useCallback(() => {
    setStudies((prev) => [...prev, { ...EMPTY_STUDY }]);
  }, []);

  const removeStudy = useCallback((index: number) => {
    setStudies((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }, []);

  const cellInput = "w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Verdict fragility"
        subtitle="How robust is a significant verdict? Compute the Walsh Fragility Index for a 2x2 table, or test a pooled meta-analysis for leave-one-out robustness — deterministically, no LLM."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <div className="mb-4 inline-flex rounded-md border border-ink/15 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => {
              setMode("table");
              setResult(null);
              setError(null);
            }}
            className={`rounded px-3 py-1.5 ${mode === "table" ? "bg-accent text-white" : "text-ink/70"}`}
          >
            Single 2x2 table
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("meta");
              setResult(null);
              setError(null);
            }}
            className={`rounded px-3 py-1.5 ${mode === "meta" ? "bg-accent text-white" : "text-ink/70"}`}
          >
            Meta-analysis set
          </button>
        </div>

        {mode === "table" ? (
          <div className="space-y-3">
            <p className="text-xs text-ink/40">
              Arm 1 = treatment, arm 2 = control. a/c = events, b/d = non-events.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-ink/60">Arm 1 events (a)</label>
                <input inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} className={`mt-1 ${cellInput}`} placeholder="e.g. 8" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/60">Arm 1 non-events (b)</label>
                <input inputMode="numeric" value={b} onChange={(e) => setB(e.target.value)} className={`mt-1 ${cellInput}`} placeholder="e.g. 92" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/60">Arm 2 events (c)</label>
                <input inputMode="numeric" value={c} onChange={(e) => setC(e.target.value)} className={`mt-1 ${cellInput}`} placeholder="e.g. 20" />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/60">Arm 2 non-events (d)</label>
                <input inputMode="numeric" value={d} onChange={(e) => setD(e.target.value)} className={`mt-1 ${cellInput}`} placeholder="e.g. 80" />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={submitTable}
                disabled={loading}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Computing…" : "Compute fragility index"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-ink/40">
              Each study is pooled as a risk ratio from its 2x2 counts. Leave-one-out deletion tests whether the pooled verdict rests on a single study.
            </p>
            <div className="space-y-3">
              {studies.map((s, i) => (
                <div key={i} className="rounded-md border border-ink/15 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <input
                      value={s.label}
                      onChange={(e) => updateStudy(i, { label: e.target.value })}
                      className="w-full max-w-xs rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                      placeholder={`Study ${i + 1} label`}
                    />
                    {studies.length > 2 ? (
                      <button
                        type="button"
                        onClick={() => removeStudy(i)}
                        className="ml-2 text-xs text-ink/40 hover:text-red-700"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <input inputMode="numeric" value={s.events1} onChange={(e) => updateStudy(i, { events1: e.target.value })} className={cellInput} placeholder="Tx events" />
                    <input inputMode="numeric" value={s.total1} onChange={(e) => updateStudy(i, { total1: e.target.value })} className={cellInput} placeholder="Tx total" />
                    <input inputMode="numeric" value={s.events2} onChange={(e) => updateStudy(i, { events2: e.target.value })} className={cellInput} placeholder="Ctl events" />
                    <input inputMode="numeric" value={s.total2} onChange={(e) => updateStudy(i, { total2: e.target.value })} className={cellInput} placeholder="Ctl total" />
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addStudy}
              className="text-sm text-accent hover:opacity-80"
            >
              + Add study
            </button>

            <div className="rounded-md border border-ink/15 bg-paper p-3">
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input
                  type="checkbox"
                  checked={useInfoSize}
                  onChange={(e) => setUseInfoSize(e.target.checked)}
                />
                Also check required information size
              </label>
              {useInfoSize ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-ink/60">Anticipated control risk (0–1)</label>
                    <input inputMode="decimal" value={controlRisk} onChange={(e) => setControlRisk(e.target.value)} className={`mt-1 ${cellInput}`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink/60">Anticipated RRR (0–1)</label>
                    <input inputMode="decimal" value={rrr} onChange={(e) => setRrr(e.target.value)} className={`mt-1 ${cellInput}`} />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={submitMeta}
                disabled={loading}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Analysing…" : "Test pooled robustness"}
              </button>
            </div>
          </div>
        )}

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <LoadingBanner message="Running the deterministic fragility computation…" />
      ) : result ? (
        <ResultView result={result} />
      ) : null}
    </div>
  );
}

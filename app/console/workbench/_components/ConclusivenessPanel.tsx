"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import type { EvidenceReport } from "./types";

// CONCLUSIVENESS (Trial Sequential Analysis) panel — additive, non-breaking.
//
// A pooled random-effects estimate can be nominally "significant" while the body
// of evidence is still too sparse to be conclusive: repeatedly testing an accruing
// meta-analysis inflates the false-positive rate exactly like interim looks in a
// single trial. This panel answers the question the pooled p-value cannot — is the
// evidence CONCLUSIVE, or is more data still needed? It calls the deterministic
// /api/trial-sequential engine (NO LLM) for the Required Information Size and the
// O'Brien–Fleming verdict, and renders only what that engine returns.
//
// It is strictly additive: it renders nothing unless the report exposes a control
// (baseline) risk AND a valid pooled relative-risk reduction. Accrued sample size
// is not carried by an effect-estimate report, so the reviewer supplies it; until
// then only the RIS target is shown.

interface ConclusivenessPanelProps {
  report: EvidenceReport;
}

interface RisResult {
  mode: "ris";
  risPerGroup: number;
  risTotal: number;
  p1: number;
  p2: number;
  diversityAdjusted: boolean;
}

type TrialSequentialVerdict =
  | "conclusive_benefit"
  | "conclusive_no_effect"
  | "insufficient_information";

interface VerdictResult {
  mode: "verdict";
  verdict: TrialSequentialVerdict;
  informationFraction: number;
  boundaryZ: number;
  cumulativeZ: number;
  crossedBenefit: boolean;
  crossedNoEffect: boolean;
  rationale: string;
}

// Two-sided z at 95% (matches the CI convention used throughout the workbench).
const Z_95 = 1.959963984540054;

// Derive the pooled cumulative Z-statistic from the random-effects estimate on the
// log scale: logPoint / SE, with SE recovered from the reported 95% CI width. This
// is pure arithmetic over numbers the deterministic engine already produced — the
// conclusiveness verdict itself is computed server-side by /api/trial-sequential.
function cumulativeZFromPooled(random: EvidenceReport["pooled"]["random"]): number | null {
  const { point, ciLower, ciUpper } = random;
  if (!(point > 0 && ciLower > 0 && ciUpper > 0 && ciUpper > ciLower)) {
    return null;
  }
  const logPoint = Math.log(point);
  const se = (Math.log(ciUpper) - Math.log(ciLower)) / (2 * Z_95);
  if (!(se > 0) || !Number.isFinite(se)) {
    return null;
  }
  // Negative Z favours treatment when the ratio point < 1 (protective effect).
  return logPoint / se;
}

const VERDICT_TONE: Record<
  TrialSequentialVerdict,
  { label: string; box: string; dot: string }
> = {
  conclusive_benefit: {
    label: "Conclusive",
    box: "border-green-300 bg-green-50",
    dot: "bg-green-500",
  },
  conclusive_no_effect: {
    label: "Conclusively no effect",
    box: "border-amber-300 bg-amber-50",
    dot: "bg-amber-500",
  },
  insufficient_information: {
    label: "Insufficient — more data needed",
    box: "border-red-300 bg-red-50",
    dot: "bg-red-500",
  },
};

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function ConclusivenessPanel({ report }: ConclusivenessPanelProps) {
  const [accruedN, setAccruedN] = useState("");
  const [ris, setRis] = useState<RisResult | null>(null);
  const [verdict, setVerdict] = useState<VerdictResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inputs the engine needs, pulled straight from the composite report. controlRisk
  // is the baseline (control-arm) risk the reviewer entered; RRR is the pooled
  // random-effects relative reduction. Both must be strictly inside (0, 1) for the
  // RIS formula to be defined — otherwise the panel hides itself.
  const controlRisk = report.absoluteEffects?.riskControl ?? null;
  const rrr = useMemo(() => {
    const r = report.pooled.random.reductionPercent / 100;
    return Number.isFinite(r) ? r : null;
  }, [report.pooled.random.reductionPercent]);
  const iSquared = report.pooled.heterogeneity.iSquared / 100;
  const cumulativeZ = useMemo(
    () => cumulativeZFromPooled(report.pooled.random),
    [report.pooled.random]
  );

  const inputsAvailable =
    controlRisk !== null &&
    controlRisk > 0 &&
    controlRisk < 1 &&
    rrr !== null &&
    rrr > 0 &&
    rrr < 1;

  const run = useCallback(async () => {
    if (!inputsAvailable || controlRisk === null || rrr === null) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Required Information Size — inflated by the pooled diversity (I²) so a
      //    heterogeneous body of evidence needs proportionally more information.
      const risRes = await fetch("/api/trial-sequential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "ris",
          controlRisk,
          relativeRiskReduction: rrr,
          ...(iSquared > 0 && iSquared < 1 ? { iSquared } : {}),
        }),
      });
      const risBody = (await risRes.json().catch(() => null)) as ApiResponse<RisResult> | null;
      if (!risBody || !risRes.ok || !risBody.success || !risBody.data) {
        throw new Error(risBody?.error ?? "Could not compute the required information size.");
      }
      const risData = risBody.data;
      setRis(risData);

      // 2. Verdict — only when the reviewer has supplied an accrued sample size and
      //    the pooled cumulative Z could be derived from the CI.
      const accrued = Number(accruedN);
      if (accruedN.trim() !== "" && Number.isFinite(accrued) && accrued > 0 && cumulativeZ !== null) {
        const vRes = await fetch("/api/trial-sequential", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "verdict",
            accruedN: accrued,
            ris: risData.risTotal,
            cumulativeZ,
          }),
        });
        const vBody = (await vRes.json().catch(() => null)) as ApiResponse<VerdictResult> | null;
        if (!vBody || !vRes.ok || !vBody.success || !vBody.data) {
          throw new Error(vBody?.error ?? "Could not compute the trial-sequential verdict.");
        }
        setVerdict(vBody.data);
      } else {
        setVerdict(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trial sequential analysis failed.");
      setRis(null);
      setVerdict(null);
    } finally {
      setLoading(false);
    }
  }, [inputsAvailable, controlRisk, rrr, iSquared, accruedN, cumulativeZ]);

  // Strictly additive: hide the whole panel when the report lacks the inputs.
  if (!inputsAvailable) {
    return null;
  }

  const tone = verdict ? VERDICT_TONE[verdict.verdict] : null;

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink/70">Conclusiveness (trial sequential analysis)</h3>
        <span className="text-xs uppercase tracking-wide text-ink/40">O&apos;Brien–Fleming</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink/50">
        Is the pooled evidence conclusive, or is more data still needed? Computes the
        required information size for the anticipated effect ({pct(rrr as number)} RRR at{" "}
        {pct(controlRisk as number)} control risk) and, once you enter the accrued sample size,
        an O&apos;Brien–Fleming verdict — deterministic, no LLM.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <label
            className="block text-xs font-medium uppercase tracking-wide text-ink/40"
            htmlFor="accrued-n"
          >
            Accrued sample size (optional)
          </label>
          <input
            id="accrued-n"
            inputMode="numeric"
            value={accruedN}
            onChange={(e) => setAccruedN(e.target.value)}
            placeholder="e.g. 4200"
            className="mt-1 w-40 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-ink/40">Total N pooled across trials → verdict</p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/5 disabled:opacity-50"
        >
          {loading ? "Computing…" : "Assess conclusiveness"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {ris ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-ink/10 bg-white p-3">
            <div className="text-xs uppercase tracking-wide text-ink/40">Required information size</div>
            <div className="mt-1 font-mono text-sm text-ink/80">{ris.risTotal.toLocaleString()}</div>
            <div className="mt-0.5 text-xs text-ink/40">
              {ris.risPerGroup.toLocaleString()} per group
              {ris.diversityAdjusted ? " · I²-adjusted" : ""}
            </div>
          </div>
          {verdict ? (
            <>
              <div className="rounded-md border border-ink/10 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-ink/40">Accrued fraction</div>
                <div className="mt-1 font-mono text-sm text-ink/80">
                  {pct(verdict.informationFraction)}
                </div>
                <div className="mt-0.5 text-xs text-ink/40">of the required information</div>
              </div>
              <div className="rounded-md border border-ink/10 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-ink/40">Boundary vs. Z</div>
                <div className="mt-1 font-mono text-sm text-ink/80">
                  ±{verdict.boundaryZ.toFixed(2)} vs {verdict.cumulativeZ.toFixed(2)}
                </div>
                <div className="mt-0.5 text-xs text-ink/40">O&apos;Brien–Fleming boundary</div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {verdict && tone ? (
        <div className={`mt-4 rounded-lg border p-4 ${tone.box}`}>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} aria-hidden />
            <h4 className="text-sm font-semibold text-ink/80">{tone.label}</h4>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink/70">{verdict.rationale}</p>
        </div>
      ) : ris && !verdict ? (
        <p className="mt-3 text-xs text-ink/50">
          Enter the accrued sample size above to get a conclusive / insufficient verdict against the
          O&apos;Brien–Fleming boundary.
        </p>
      ) : null}
    </div>
  );
}

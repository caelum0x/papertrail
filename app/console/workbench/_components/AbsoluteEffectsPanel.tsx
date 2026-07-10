"use client";

import type { AbsoluteEffect } from "./types";

// Absolute-effect translation of the pooled random-effects estimate against the
// entered baseline risk: ARR/ARI, NNT/NNH, and events-per-1000. Only rendered when
// a baseline risk was supplied and the engine returned a valid translation.

interface AbsoluteEffectsPanelProps {
  effect: AbsoluteEffect;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-ink/10 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-ink/40">{label}</div>
      <div className="mt-1 font-mono text-sm text-ink/80">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-ink/40">{hint}</div> : null}
    </div>
  );
}

const DIRECTION_LABEL: Record<AbsoluteEffect["direction"], string> = {
  benefit: "Net benefit",
  harm: "Net harm",
  null: "No absolute difference",
};

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function AbsoluteEffectsPanel({ effect }: AbsoluteEffectsPanelProps) {
  const nntAbs = Math.abs(effect.nnt);
  const eventDelta = Math.abs(effect.eventsPer1000Control - effect.eventsPer1000Treated);
  const isBenefit = effect.direction === "benefit";
  const isHarm = effect.direction === "harm";

  return (
    <div className="space-y-4">
      <div className="text-sm text-ink/70">
        <span className="font-medium text-ink/80">{DIRECTION_LABEL[effect.direction]}.</span>{" "}
        {effect.direction === "null"
          ? "For every 1000 patients treated, no change in the number of events versus control."
          : isBenefit
            ? `For every 1000 patients treated, ~${eventDelta} fewer events (NNT ${nntAbs} to prevent one event).`
            : `For every 1000 patients treated, ~${eventDelta} more events (NNH ${nntAbs} to cause one additional event).`}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label={effect.absoluteRiskReduction >= 0 ? "Abs. risk reduction" : "Abs. risk increase"}
          value={pct(Math.abs(effect.absoluteRiskReduction))}
          hint={`95% CI ${pct(effect.arrCiLower)}–${pct(effect.arrCiUpper)}`}
        />
        <Stat
          label={isHarm ? "NNH" : "NNT"}
          value={Number.isFinite(nntAbs) ? `${nntAbs}` : "∞"}
          hint={`CI ${effect.nntCiLower}–${effect.nntCiUpper}`}
        />
        <Stat
          label="Events / 1000"
          value={`${effect.eventsPer1000Treated} vs ${effect.eventsPer1000Control}`}
          hint="treated vs control"
        />
        <Stat
          label="Risk (treated)"
          value={pct(effect.riskTreated)}
          hint={`baseline ${pct(effect.riskControl)}`}
        />
      </div>
    </div>
  );
}

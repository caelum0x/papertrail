import type { GroundedEffect, EffectReconciliation } from "./types";

// Effects table: one row per grounded effect size, each with its verbatim
// source quote and the deterministic reconciliation verdict. Every number shown
// here is backed by a quote located as an exact span of the source text — the
// engine drops any effect it couldn't ground before it reaches this table.

const RECON_STYLES: Record<EffectReconciliation, { label: string; cls: string }> = {
  confirmed: { label: "Confirmed", cls: "bg-emerald-100 text-emerald-800" },
  mismatch: { label: "Mismatch", cls: "bg-rose-100 text-rose-800" },
  unverified: { label: "Unverified", cls: "bg-ink/10 text-ink/50" },
};

function formatValue(e: GroundedEffect): string {
  if (e.claimed_point === null) return "—";
  const point = e.is_percent ? `${e.claimed_point}%` : `${e.claimed_point}`;
  if (e.claimed_ci_low !== null && e.claimed_ci_high !== null) {
    return `${point} (95% CI ${e.claimed_ci_low}–${e.claimed_ci_high})`;
  }
  return point;
}

interface EffectsTableProps {
  effects: GroundedEffect[];
  droppedCount: number;
  totalExtracted: number;
}

export function EffectsTable({ effects, droppedCount, totalExtracted }: EffectsTableProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
          Reported effect sizes
        </h2>
        <p className="text-xs text-ink/40">
          {effects.length} grounded of {totalExtracted} extracted
          {droppedCount > 0 ? ` · ${droppedCount} dropped (ungroundable)` : ""}
        </p>
      </div>

      {effects.length === 0 ? (
        <p className="mt-3 text-sm text-ink/50">
          No effect sizes could be grounded to an exact source span. Nothing is shown rather
          than surfacing an unsourced number.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {effects.map((e, i) => {
            const recon = RECON_STYLES[e.reconciliation];
            return (
              <div key={i} className="rounded-lg border border-ink/10 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-ink/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-ink/60">
                    {e.measure}
                  </span>
                  <span className="text-sm font-semibold text-ink/80">{formatValue(e)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${recon.cls}`}>
                    {recon.label}
                  </span>
                  {e.grounding.status === "approximate" ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                      approx. span
                    </span>
                  ) : null}
                  <span className="ml-auto text-xs text-ink/40">{e.endpoint}</span>
                </div>

                <blockquote className="mt-2 border-l-2 border-accent/40 pl-3 text-sm italic text-ink/70">
                  “{e.quote}”
                </blockquote>

                <p className="mt-2 text-xs text-ink/45">{e.note}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

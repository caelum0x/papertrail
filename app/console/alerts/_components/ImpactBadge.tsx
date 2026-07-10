import type { AlertImpact } from "@/lib/alerts/schemas";

// Visual impact token for a Claude-assessed evidence alert. Colors follow the app's
// convention: confirms = positive/green, weakens = caution/amber, overturns =
// warning/rose, none = neutral.

interface ImpactBadgeProps {
  impact: AlertImpact;
  confidence?: number;
}

const IMPACT_STYLES: Record<AlertImpact, { label: string; className: string }> = {
  confirms: {
    label: "Confirms",
    className: "border-emerald-400/50 bg-emerald-50/70 text-emerald-800",
  },
  weakens: {
    label: "Weakens",
    className: "border-amber-400/50 bg-amber-50/70 text-amber-800",
  },
  overturns: {
    label: "Overturns",
    className: "border-rose-400/50 bg-rose-50/70 text-rose-800",
  },
  none: {
    label: "No change",
    className: "border-ink/20 bg-white/60 text-ink/60",
  },
};

export function ImpactBadge({ impact, confidence }: ImpactBadgeProps) {
  const style = IMPACT_STYLES[impact];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${style.className}`}
    >
      {style.label}
      {typeof confidence === "number" ? (
        <span className="font-mono text-[10px] opacity-70">{Math.round(confidence * 100)}%</span>
      ) : null}
    </span>
  );
}

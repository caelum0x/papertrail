// Deterministic flip-verdict badge. Colour is a pure function of the verdict — no
// LLM, no free text — so the same verdict always renders the same chip.

import type { FlipVerdict } from "./types";

const VERDICT_STYLE: Record<FlipVerdict, { label: string; cls: string }> = {
  would_flip: { label: "Would flip", cls: "bg-red-50 text-red-800" },
  strengthens: { label: "Strengthens", cls: "bg-emerald-50 text-emerald-800" },
  weakens: { label: "Weakens", cls: "bg-amber-50 text-amber-800" },
  no_change: { label: "No change", cls: "bg-ink/5 text-ink/60" },
  insufficient_evidence: {
    label: "Insufficient evidence",
    cls: "bg-ink/5 text-ink/40",
  },
};

export function FlipVerdictBadge({ verdict }: { verdict: FlipVerdict }) {
  const style = VERDICT_STYLE[verdict];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.cls}`}>
      {style.label}
    </span>
  );
}

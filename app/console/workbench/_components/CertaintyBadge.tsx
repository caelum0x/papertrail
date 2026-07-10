"use client";

import type { GradeResult } from "./types";

// GRADE certainty badge + the explicit downgrade trail behind it. Color-codes the
// four-level rating and lists each domain that pulled certainty down, with its
// step count and reason — so the rating is defensible line by line. Presentation
// only; every value comes from the deterministic GRADE engine.

const TONE: Record<GradeResult["certainty"], { label: string; box: string; dot: string }> = {
  high: { label: "High certainty", box: "border-green-300 bg-green-50", dot: "bg-green-500" },
  moderate: { label: "Moderate certainty", box: "border-lime-300 bg-lime-50", dot: "bg-lime-500" },
  low: { label: "Low certainty", box: "border-amber-300 bg-amber-50", dot: "bg-amber-500" },
  very_low: { label: "Very low certainty", box: "border-red-300 bg-red-50", dot: "bg-red-500" },
};

interface CertaintyBadgeProps {
  certainty: GradeResult;
}

export function CertaintyBadge({ certainty }: CertaintyBadgeProps) {
  const tone = TONE[certainty.certainty] ?? TONE.very_low;

  return (
    <div className={`rounded-lg border p-4 ${tone.box}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} aria-hidden />
        <h3 className="text-sm font-semibold text-ink/80">GRADE: {tone.label}</h3>
        <span className="ml-auto text-xs uppercase tracking-wide text-ink/40">
          starts {certainty.startingLevel}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink/70">{certainty.rationale}</p>

      {certainty.downgrades.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {certainty.downgrades.map((d, i) => (
            <li key={`${d.domain}-${i}`} className="flex gap-2 text-sm text-ink/70">
              <span className="font-mono text-xs text-ink/50">−{d.steps}</span>
              <span>
                <span className="font-medium text-ink/80">{d.domain.replace(/_/g, " ")}:</span>{" "}
                {d.reason}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink/50">No GRADE downgrades applied.</p>
      )}
    </div>
  );
}

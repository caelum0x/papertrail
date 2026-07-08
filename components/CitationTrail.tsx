"use client";

interface FlaggedSpan {
  claim_span: string;
  source_span: string;
  issue: string;
}

interface CitationTrailProps {
  flaggedSpans: FlaggedSpan[];
  /** When set, each flag becomes clickable and scrolls to the matching highlighted
   *  source span (DOM id `${spanIdPrefix}-${index}`), briefly flashing it. */
  spanIdPrefix?: string;
}

export function CitationTrail({ flaggedSpans, spanIdPrefix }: CitationTrailProps) {
  if (flaggedSpans.length === 0) {
    return (
      <p className="text-sm text-ink/50">
        No specific discrepancies flagged between the claim and the source.
      </p>
    );
  }

  function focusSpan(index: number) {
    if (!spanIdPrefix) return;
    const el = document.getElementById(`${spanIdPrefix}-${index}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-accent");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-accent"), 1200);
  }

  return (
    <div className="flex flex-col gap-3">
      {flaggedSpans.map((span, i) => {
        const interactive = Boolean(spanIdPrefix);
        return (
          <div
            key={i}
            onClick={interactive ? () => focusSpan(i) : undefined}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      focusSpan(i);
                    }
                  }
                : undefined
            }
            className={`rounded-lg border border-ink/10 bg-white p-3 text-sm ${
              interactive ? "cursor-pointer transition hover:border-accent/40 hover:bg-accent/5" : ""
            }`}
          >
            <div className="mb-1">
              <span className="font-medium">Claim says:</span>{" "}
              <span className="italic">&ldquo;{span.claim_span}&rdquo;</span>
            </div>
            <div className="mb-1">
              <span className="font-medium">Source says:</span>{" "}
              <span className="italic">&ldquo;{span.source_span}&rdquo;</span>
            </div>
            <div className="text-ink/60">{span.issue}</div>
            {interactive && <div className="mt-1 text-xs text-accent">Click to locate in source →</div>}
          </div>
        );
      })}
    </div>
  );
}

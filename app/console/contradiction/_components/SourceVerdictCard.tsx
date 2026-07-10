import { DIMENSION_LABELS, type SourceVerdict } from "./types";

// One source's grounded verdict card: its side (supporting/refuting), the signed Valsci
// support + relevance, the deterministic mechanism belief, its grounded support span, and
// the grounded design features it reports per dimension. Every quote shown is a verbatim
// substring of the source (grounded upstream), never a paraphrase.

interface SourceVerdictCardProps {
  verdict: SourceVerdict;
  /** Highlight the dimension the reversal was attributed to, if any. */
  attributedDimension: string | null;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function SourceVerdictCard({ verdict, attributedDimension }: SourceVerdictCardProps) {
  const isSupporting = verdict.side === "supporting";
  const sideColor = isSupporting
    ? "border-emerald-200 bg-emerald-50"
    : "border-red-200 bg-red-50";
  const label = verdict.title ?? `${verdict.source_type} · ${verdict.external_id}`;

  return (
    <div className={`rounded-lg border ${sideColor} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink/80">{label}</p>
          <p className="mt-0.5 text-xs text-ink/40">
            {verdict.source_type} · {verdict.external_id}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            isSupporting ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
          }`}
        >
          {isSupporting ? "Supports" : "Refutes"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/50">
        <span>
          support{" "}
          <span className="font-medium text-ink/70">{verdict.support.toFixed(2)}</span>
        </span>
        <span>
          relevance <span className="font-medium text-ink/70">{pct(verdict.relevance)}</span>
        </span>
        {verdict.mechanism_belief > 0 ? (
          <span>
            mechanism belief{" "}
            <span className="font-medium text-ink/70">{pct(verdict.mechanism_belief)}</span>
          </span>
        ) : null}
      </div>

      <blockquote className="mt-3 border-l-2 border-ink/20 pl-3 text-sm italic text-ink/70">
        &ldquo;{verdict.span.text}&rdquo;
      </blockquote>

      {verdict.features.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
            Design features
          </p>
          {verdict.features.map((f, i) => {
            const highlighted = attributedDimension === f.dimension;
            return (
              <div
                key={`${f.dimension}-${i}`}
                className={`rounded-md border px-2 py-1.5 text-xs ${
                  highlighted ? "border-accent/40 bg-accent/5" : "border-ink/15 bg-white"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink/70">{DIMENSION_LABELS[f.dimension]}</span>
                  <span className="text-ink/50">{f.value}</span>
                  {highlighted ? (
                    <span className="ml-auto rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      attributed
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-ink/50">&ldquo;{f.quote}&rdquo;</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink/30">No grounded design features reported.</p>
      )}
    </div>
  );
}

import type { PublicationBiasReport } from "@/lib/evidenceReport";

// Publication-bias panel: Egger's test result + its plain-language note. When the
// test could not be run (fewer than three studies) we say so honestly rather than
// implying symmetry.

interface BiasPanelProps {
  bias: PublicationBiasReport;
}

function tone(verdict: PublicationBiasReport["verdict"]): string {
  if (verdict === "possible_small_study_effects") return "text-amber-800";
  if (verdict === "no_asymmetry") return "text-emerald-800";
  return "text-ink/50";
}

export function BiasPanel({ bias }: BiasPanelProps) {
  const { test, verdict, note } = bias;
  return (
    <div>
      {test ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink/40">Egger intercept</div>
            <div className="mt-0.5 text-sm font-medium text-ink/80">
              {test.intercept.toFixed(3)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ink/40">Egger p-value</div>
            <div className={`mt-0.5 text-sm font-medium ${tone(verdict)}`}>
              {test.pValue.toFixed(3)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ink/40">t (df {test.df})</div>
            <div className="mt-0.5 text-sm font-medium text-ink/80">{test.t.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ink/40">Asymmetry</div>
            <div className={`mt-0.5 text-sm font-medium ${tone(verdict)}`}>
              {test.asymmetry ? "Present" : "None"}
            </div>
          </div>
        </div>
      ) : null}
      <p className="mt-3 text-sm text-ink/60">{note}</p>
    </div>
  );
}

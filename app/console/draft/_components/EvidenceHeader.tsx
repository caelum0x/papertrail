// Header for a drafted section: shows the ENGINE's verified ground-truth (the pooled
// number every efficacy sentence was reconciled against) plus roll-up badges. This is
// the "proves it" frame — before reading the prose, the reader sees exactly what the
// deterministic engine established.

import type { DraftAssistResult } from "./types";

interface EvidenceHeaderProps {
  evidence: DraftAssistResult["evidence"];
  summary: DraftAssistResult["summary"];
  section: string;
}

function Badge({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-60">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

export function EvidenceHeader({ evidence, summary, section }: EvidenceHeaderProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-xs font-medium capitalize text-ink/70">
          {section}
        </span>
        {evidence.sufficient ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            Evidence pooled
          </span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            Insufficient evidence — hedged
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Badge
          label="Pooled reduction"
          value={
            evidence.pooledReductionPercent !== null
              ? `${evidence.pooledReductionPercent}%`
              : "—"
          }
          tone="border-ink/10 text-ink/80"
        />
        <Badge label="Measure" value={evidence.measure ?? "—"} tone="border-ink/10 text-ink/80" />
        <Badge
          label="GRADE certainty"
          value={evidence.certainty ?? "—"}
          tone="border-ink/10 text-ink/80"
        />
        <Badge
          label="Grounded"
          value={`${summary.grounded}/${summary.totalSentences}`}
          tone="border-emerald-100 text-emerald-700"
        />
      </div>

      {summary.corrected > 0 ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {summary.corrected} sentence{summary.corrected === 1 ? "" : "s"} auto-corrected against
          the engine&apos;s verified number.
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-ink/50">{evidence.rationale}</p>
    </div>
  );
}

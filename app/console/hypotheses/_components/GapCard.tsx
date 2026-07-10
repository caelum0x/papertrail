import type { EvidenceSignal, ResearchGap } from "./types";

// One research-gap card: the deterministic engine signal that supports the gap (the
// concrete numbers a reviewer can check) paired with Claude's reasoning for WHY it is a
// scientifically actionable gap. The signal is shown first, on purpose — the gap is only
// as trustworthy as the engine fact it rests on.

const KIND_LABEL: Record<EvidenceSignal["kind"], string> = {
  no_support_found: "No support found",
  few_studies: "Sparse evidence",
  high_heterogeneity: "Inconsistent effect",
  wide_confidence_interval: "Imprecise estimate",
  crosses_null: "Effect not established",
  publication_bias: "Possible publication bias",
  low_certainty: "Low GRADE certainty",
  claim_pool_mismatch: "Claim / pool mismatch",
};

interface GapCardProps {
  gap: ResearchGap;
  signal: EvidenceSignal | undefined;
}

function MetricRow({ metrics }: { metrics: Record<string, number | string> }) {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-1 text-xs">
          <dt className="font-medium text-ink/50">{k}</dt>
          <dd className="font-mono text-ink/70">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function GapCard({ gap, signal }: GapCardProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-ink/80">{gap.title}</h4>
        {signal ? (
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
            {KIND_LABEL[signal.kind]}
          </span>
        ) : null}
      </div>

      {signal ? (
        <div className="mt-2 rounded-md border-l-2 border-accent/50 bg-ink/[0.03] px-3 py-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
            Engine signal (grounded)
          </p>
          <p className="mt-1 text-sm text-ink/70">{signal.detail}</p>
          <MetricRow metrics={signal.metrics} />
        </div>
      ) : null}

      <p className="mt-3 text-sm text-ink/70">{gap.why_gap}</p>

      {gap.affected_population ? (
        <p className="mt-2 text-xs text-ink/50">
          <span className="font-medium">Affected population:</span> {gap.affected_population}
        </p>
      ) : null}
    </div>
  );
}

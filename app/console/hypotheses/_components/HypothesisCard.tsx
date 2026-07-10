import type { EvidenceSignal, Hypothesis } from "./types";

// One testable-hypothesis card: the falsifiable statement, its prediction, a suggested
// study design, and the rationale — all tied to the specific engine signal (by
// signal_id) that motivated it. A hypothesis with no grounded signal is never rendered
// (the API drops it), so `signal` should always be present here.

interface HypothesisCardProps {
  hypothesis: Hypothesis;
  signal: EvidenceSignal | undefined;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink/40">{label}</p>
      <p className="mt-0.5 text-sm text-ink/70">{value}</p>
    </div>
  );
}

export function HypothesisCard({ hypothesis, signal }: HypothesisCardProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <p className="text-sm font-semibold text-ink/80">{hypothesis.statement}</p>

      <div className="mt-3 space-y-3">
        <Field label="Testable prediction" value={hypothesis.testable_prediction} />
        <Field label="Suggested design" value={hypothesis.suggested_design} />
        <Field label="Rationale" value={hypothesis.rationale} />
      </div>

      {signal ? (
        <p className="mt-3 text-xs text-ink/50">
          <span className="font-medium">Tied to signal:</span> {signal.detail}
        </p>
      ) : null}
    </div>
  );
}

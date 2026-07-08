import { formatDate, type UsageMeter, type UsageSummary } from "./types";

function Meter({ meter }: { meter: UsageMeter }) {
  const pct = Math.round(meter.ratio * 100);
  const unlimited = meter.limit === null;
  const near = pct >= 90;
  return (
    <li>
      <div className="flex items-center justify-between text-xs text-ink/60">
        <span className="capitalize">{meter.kind.replace(/_/g, " ")}</span>
        <span className="tabular-nums">
          {meter.used.toLocaleString()}
          {unlimited ? " / ∞" : ` / ${meter.limit?.toLocaleString()}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 bg-paper rounded overflow-hidden">
        <div
          className={near ? "h-full bg-red-500" : "h-full bg-accent"}
          style={{ width: unlimited ? "0%" : `${pct}%` }}
        />
      </div>
    </li>
  );
}

interface UsageCardProps {
  usage: UsageSummary | null;
}

// The "Usage this period" panel: a labelled billing-period range plus one
// progress meter per tracked usage kind.
export function UsageCard({ usage }: UsageCardProps) {
  return (
    <section className="mt-6 bg-white border border-ink/10 rounded-lg p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/70">Usage this period</h2>
        {usage ? (
          <span className="text-xs text-ink/40">
            {formatDate(usage.periodStart)} – {formatDate(usage.periodEnd)}
          </span>
        ) : null}
      </div>
      {usage && usage.meters.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {usage.meters.map((m) => (
            <Meter key={m.kind} meter={m} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink/40">No usage recorded yet.</p>
      )}
    </section>
  );
}

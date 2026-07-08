import type { PublicationReadiness } from "@/app/api/publications/lib/types";
import { roleLabel, decisionLabel } from "./mlr";

interface ReadinessPanelProps {
  readiness: PublicationReadiness;
}

// Readiness summary card: attached/verified/flagged counts plus per-role MLR badges.
export function ReadinessPanel({ readiness }: ReadinessPanelProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/15 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink/70">Readiness</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            readiness.ready
              ? "bg-green-50 text-green-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {readiness.ready ? "Ready" : "Not ready"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <ReadinessStat value={readiness.totalClaims} label="Attached" />
        <ReadinessStat
          value={readiness.accurateClaims}
          label="Verified accurate"
          className="text-green-700"
        />
        <ReadinessStat
          value={readiness.flaggedClaims}
          label="Flagged"
          className="text-red-700"
        />
        <ReadinessStat
          value={readiness.unverifiedClaims}
          label="Unverified"
          className="text-ink/60"
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {readiness.mlrStatus.map((m) => (
          <span
            key={m.role}
            className={`rounded-md border px-3 py-1 text-xs ${
              m.decision === "approved"
                ? "border-green-600/30 text-green-700"
                : m.decision === "rejected" || m.decision === "changes_requested"
                ? "border-red-600/30 text-red-700"
                : "border-ink/15 text-ink/50"
            }`}
          >
            {roleLabel(m.role)}: {decisionLabel(m.decision)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ReadinessStat({
  value,
  label,
  className = "text-ink/80",
}: {
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <div>
      <div className={`text-2xl font-semibold ${className}`}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-ink/40">{label}</div>
    </div>
  );
}

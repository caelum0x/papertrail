import { CheckRow } from "./CheckRow";

type HealthStatus = "ok" | "degraded";

export interface HealthResponse {
  status: HealthStatus;
  checks: {
    database: boolean;
    anthropic_key_present: boolean;
    voyage_key_present: boolean;
  };
  timestamp: string;
}

interface HealthCardProps {
  health: HealthResponse;
}

export function HealthCard({ health }: HealthCardProps) {
  return (
    <div className="mt-8 rounded-lg border border-ink/10 bg-white p-6">
      <div className="flex items-center justify-between">
        <span className="text-sm uppercase tracking-wide text-ink/60">
          Overall
        </span>
        {health.status === "ok" ? (
          <span className="rounded-full bg-green-600/10 px-3 py-1 text-sm font-semibold text-green-600">
            &#10003; Operational
          </span>
        ) : (
          <span className="rounded-full bg-red-600/10 px-3 py-1 text-sm font-semibold text-red-600">
            &#10007; Degraded
          </span>
        )}
      </div>

      <div className="mt-6">
        <CheckRow label="Database connection" passed={health.checks.database} />
        <CheckRow
          label="Anthropic API key present"
          passed={health.checks.anthropic_key_present}
        />
        <CheckRow
          label="Voyage API key present"
          passed={health.checks.voyage_key_present}
        />
      </div>

      <p className="mt-6 text-xs text-ink/60">
        Last checked: {new Date(health.timestamp).toLocaleString()}
      </p>
    </div>
  );
}

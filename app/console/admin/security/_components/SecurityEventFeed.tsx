import { SeverityBadge, type Severity } from "./SeverityBadge";

// One security_events finding as rendered in the feed. `detail` is a PII-free
// bag of ids/counts/thresholds emitted by the deterministic detectors.
export interface SecurityEventItem {
  id: string;
  kind: string;
  severity: Severity;
  detail: Record<string, unknown>;
  sourceIp: string | null;
  detectedAt: string;
}

// Human-readable label per detector kind. Falls back to the raw kind so a new
// detector still renders sensibly before this map is updated.
const KIND_LABEL: Record<string, string> = {
  api_key_from_new_ip: "New API key activity",
  quota_exhaustion_spike: "Quota exhaustion spike",
  auth_failure_burst: "Auth failure burst",
  cross_tenant_probe: "Cross-tenant probe",
};

function labelForKind(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

// Renders the detail bag as compact "key: value" chips. Values are stringified
// defensively; detail only ever holds ids/counts/thresholds, never raw text.
function DetailChips({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail);
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="inline-flex items-center rounded bg-ink/5 px-1.5 py-0.5 text-xs text-ink/50 tabular-nums"
        >
          <span className="text-ink/40">{key}:</span>
          <span className="ml-1 text-ink/70">{String(value)}</span>
        </span>
      ))}
    </div>
  );
}

interface SecurityEventFeedProps {
  events: SecurityEventItem[];
  loading: boolean;
  error: string | null;
}

// The main threat-detection feed: one row per finding, newest first, with a
// severity badge, human label, detail chips, and detection time.
export function SecurityEventFeed({
  events,
  loading,
  error,
}: SecurityEventFeedProps) {
  return (
    <div className="mt-6 bg-white border border-ink/10 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
        Detected events
      </div>
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading events...</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : events.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">
          No security events detected.
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {events.map((event) => (
            <li key={event.id} className="px-5 py-3 flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={event.severity} />
                  <span className="text-sm font-medium text-ink/80">
                    {labelForKind(event.kind)}
                  </span>
                  {event.sourceIp ? (
                    <span className="text-xs text-ink/40 tabular-nums">
                      {event.sourceIp}
                    </span>
                  ) : null}
                </div>
                <DetailChips detail={event.detail} />
              </div>
              <div className="text-xs text-ink/40 shrink-0 tabular-nums">
                {new Date(event.detectedAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

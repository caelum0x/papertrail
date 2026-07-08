import type { IntegrationEvent } from "./types";

function EventRow({ event }: { event: IntegrationEvent }) {
  const ev = event;
  return (
    <li className="px-5 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-ink/80 truncate">
          {ev.event}
          <span className="ml-2 text-xs text-ink/40">{ev.direction}</span>
        </div>
        <div className="text-xs text-ink/40 truncate">
          {typeof ev.payload.detail === "string" ? ev.payload.detail : ""} ·{" "}
          {new Date(ev.createdAt).toLocaleString()}
        </div>
      </div>
      <span
        className={`text-xs shrink-0 ${
          ev.status === "success"
            ? "text-ink/60"
            : ev.status === "skipped"
            ? "text-ink/40"
            : "text-red-600"
        }`}
      >
        {ev.status}
      </span>
    </li>
  );
}

interface EventLogProps {
  events: IntegrationEvent[];
}

// The recent-events card for an integration: header + empty state or a list of
// event rows (newest first, as returned by the API).
export function EventLog({ events }: EventLogProps) {
  return (
    <div className="mt-8 bg-white border border-ink/10 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
        Recent events
      </div>
      {events.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">No events yet.</div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {events.map((ev) => (
            <EventRow key={ev.id} event={ev} />
          ))}
        </ul>
      )}
    </div>
  );
}

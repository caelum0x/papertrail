import type { AuditLogEntry } from "./types";

interface AuditRowProps {
  entry: AuditLogEntry;
}

// A single audit entry row: action + entity, actor, timestamp, and optional
// metadata payload.
function AuditRow({ entry }: AuditRowProps) {
  const hasMetadata =
    entry.metadata && Object.keys(entry.metadata).length > 0;
  return (
    <li className="px-5 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-ink/80">
            <span className="font-medium">{entry.action}</span>
            <span className="text-ink/40"> · {entry.entityType}</span>
          </div>
          <div className="text-xs text-ink/40 truncate">
            {entry.userName ?? entry.userEmail ?? "System"}
            {entry.entityId ? ` · ${entry.entityId}` : ""}
          </div>
        </div>
        <div className="text-xs text-ink/40 shrink-0 tabular-nums">
          {new Date(entry.createdAt).toLocaleString()}
        </div>
      </div>
      {hasMetadata ? (
        <pre className="mt-2 text-xs text-ink/50 bg-paper rounded p-2 overflow-x-auto">
          {JSON.stringify(entry.metadata, null, 2)}
        </pre>
      ) : null}
    </li>
  );
}

interface AuditListProps {
  entries: AuditLogEntry[];
  loading: boolean;
  error: string | null;
}

// Card wrapping the audit entries with loading/error/empty states.
export function AuditList({ entries, loading, error }: AuditListProps) {
  return (
    <div className="mt-4 bg-white border border-ink/10 rounded-lg overflow-hidden">
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading audit log...</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : entries.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">
          No audit events match these filters.
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </div>
  );
}

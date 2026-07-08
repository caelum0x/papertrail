export interface RecentActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userName: string | null;
  userEmail: string | null;
  createdAt: string;
}

interface RecentActivityListProps {
  entries: RecentActivityEntry[];
  loading: boolean;
  error: string | null;
}

// Compact list of recent audit-trail actions for the admin activity sub-page.
export function RecentActivityList({
  entries,
  loading,
  error,
}: RecentActivityListProps) {
  return (
    <div className="mt-6 bg-white border border-ink/10 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
        Recent activity
      </div>
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading activity...</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : entries.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">No recent activity.</div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="px-5 py-3 flex items-center justify-between gap-4"
            >
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

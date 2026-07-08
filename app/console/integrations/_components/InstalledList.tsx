import Link from "next/link";
import type { Integration } from "./types";

function InstalledRow({
  integration,
  onToggleStatus,
  onDelete,
}: {
  integration: Integration;
  onToggleStatus: (integration: Integration) => void;
  onDelete: (id: string) => void;
}) {
  const i = integration;
  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-ink/80 truncate">
            {i.name}
            <span className="ml-2 text-xs text-ink/40">{i.provider}</span>
            {i.status === "disabled" ? (
              <span className="ml-2 text-xs text-red-600">disabled</span>
            ) : null}
          </div>
          <div className="text-xs text-ink/40">
            Added {new Date(i.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href={`/console/integrations/${i.id}`}
            className="text-xs text-ink/60 hover:text-accent"
          >
            Configure
          </Link>
          <button
            onClick={() => onToggleStatus(i)}
            className="text-xs text-ink/60 hover:text-accent"
          >
            {i.status === "active" ? "Disable" : "Enable"}
          </button>
          <button
            onClick={() => onDelete(i.id)}
            className="text-xs text-red-600 hover:underline"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

interface InstalledListProps {
  installed: Integration[];
  loading: boolean;
  error: string | null;
  onToggleStatus: (integration: Integration) => void;
  onDelete: (id: string) => void;
}

// The installed-connectors card: header + loading / error / empty / list body.
export function InstalledList({
  installed,
  loading,
  error,
  onToggleStatus,
  onDelete,
}: InstalledListProps) {
  return (
    <div className="mt-6 bg-white border border-ink/10 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
        Installed
      </div>
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading integrations...</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : installed.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">
          No integrations installed yet. Add one from the catalog below.
        </div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {installed.map((i) => (
            <InstalledRow
              key={i.id}
              integration={i}
              onToggleStatus={onToggleStatus}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

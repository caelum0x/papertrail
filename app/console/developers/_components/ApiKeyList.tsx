import type { ApiKeySummary } from "./types";

function ApiKeyRow({
  apiKey,
  onRevoke,
}: {
  apiKey: ApiKeySummary;
  onRevoke: (id: string) => void;
}) {
  const k = apiKey;
  return (
    <li className="px-5 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-ink/80 truncate">
          {k.name}
          {!k.active ? (
            <span className="ml-2 text-xs text-red-600">revoked</span>
          ) : null}
        </div>
        <div className="text-xs text-ink/40 truncate">
          <code>{k.keyPrefix ?? "—"}…</code>
          {k.createdByName ? ` · by ${k.createdByName}` : ""} ·{" "}
          {new Date(k.createdAt).toLocaleDateString()}
          {k.lastUsedAt
            ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
            : " · never used"}
        </div>
      </div>
      {k.active ? (
        <button
          onClick={() => onRevoke(k.id)}
          className="text-xs text-red-600 hover:underline shrink-0"
        >
          Revoke
        </button>
      ) : null}
    </li>
  );
}

interface ApiKeyListProps {
  keys: ApiKeySummary[];
  loading: boolean;
  error: string | null;
  onRevoke: (id: string) => void;
}

// The API-keys card: header, and a loading / error / empty / list body.
export function ApiKeyList({ keys, loading, error, onRevoke }: ApiKeyListProps) {
  return (
    <div className="mt-6 bg-white border border-ink/10 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
        Keys
      </div>
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading keys...</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : keys.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">No API keys yet.</div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {keys.map((k) => (
            <ApiKeyRow key={k.id} apiKey={k} onRevoke={onRevoke} />
          ))}
        </ul>
      )}
    </div>
  );
}

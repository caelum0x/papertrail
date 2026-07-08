import type { ApiKeySummary } from "./apiKeyTypes";

interface ApiKeyRowProps {
  apiKey: ApiKeySummary;
  onRevoke: (id: string) => void;
}

// A single API key row: name, metadata line, and a revoke action if active.
function ApiKeyRow({ apiKey, onRevoke }: ApiKeyRowProps) {
  return (
    <li className="px-5 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm text-ink/80 truncate">
          {apiKey.name}
          {!apiKey.active ? (
            <span className="ml-2 text-xs text-red-600">revoked</span>
          ) : null}
        </div>
        <div className="text-xs text-ink/40 truncate">
          <code>{apiKey.keyPrefix ?? "—"}…</code>
          {apiKey.createdByName ? ` · by ${apiKey.createdByName}` : ""} ·{" "}
          {new Date(apiKey.createdAt).toLocaleDateString()}
          {apiKey.lastUsedAt
            ? ` · last used ${new Date(apiKey.lastUsedAt).toLocaleDateString()}`
            : " · never used"}
        </div>
      </div>
      {apiKey.active ? (
        <button
          onClick={() => onRevoke(apiKey.id)}
          className="text-xs text-red-600 hover:underline shrink-0"
        >
          Revoke
        </button>
      ) : null}
    </li>
  );
}

interface ApiKeysListProps {
  keys: ApiKeySummary[];
  loading: boolean;
  error: string | null;
  onRevoke: (id: string) => void;
}

// Card listing API keys with loading/error/empty states.
export function ApiKeysList({
  keys,
  loading,
  error,
  onRevoke,
}: ApiKeysListProps) {
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

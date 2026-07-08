import type { WebhookSummary } from "./webhookTypes";

function WebhookRow({
  hook,
  testResult,
  onTest,
  onToggleStatus,
  onDelete,
}: {
  hook: WebhookSummary;
  testResult?: string;
  onTest: (id: string) => void;
  onToggleStatus: (hook: WebhookSummary) => void;
  onDelete: (id: string) => void;
}) {
  const h = hook;
  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-ink/80 truncate">
            {h.url}
            {h.status === "disabled" ? (
              <span className="ml-2 text-xs text-red-600">disabled</span>
            ) : null}
          </div>
          <div className="text-xs text-ink/40 truncate">
            {h.events.join(", ") || "no events"} ·{" "}
            <code>{h.secretHint ?? "—"}</code> ·{" "}
            {new Date(h.createdAt).toLocaleDateString()}
          </div>
          {testResult ? (
            <div className="mt-1 text-xs text-ink/60">Test: {testResult}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => onTest(h.id)}
            className="text-xs text-ink/60 hover:text-accent"
          >
            Test
          </button>
          <button
            onClick={() => onToggleStatus(h)}
            className="text-xs text-ink/60 hover:text-accent"
          >
            {h.status === "active" ? "Disable" : "Enable"}
          </button>
          <button
            onClick={() => onDelete(h.id)}
            className="text-xs text-red-600 hover:underline"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

interface WebhookListProps {
  hooks: WebhookSummary[];
  loading: boolean;
  error: string | null;
  testResult: Record<string, string>;
  onTest: (id: string) => void;
  onToggleStatus: (hook: WebhookSummary) => void;
  onDelete: (id: string) => void;
}

// The registered-endpoints card: header + loading / error / empty / list body.
export function WebhookList({
  hooks,
  loading,
  error,
  testResult,
  onTest,
  onToggleStatus,
  onDelete,
}: WebhookListProps) {
  return (
    <div className="mt-6 bg-white border border-ink/10 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
        Endpoints
      </div>
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading webhooks...</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : hooks.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">No webhooks yet.</div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {hooks.map((h) => (
            <WebhookRow
              key={h.id}
              hook={h}
              testResult={testResult[h.id]}
              onTest={onTest}
              onToggleStatus={onToggleStatus}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

import type { MonitorSourceType, MonitorFrequency } from "@/lib/monitoring/types";
import { MONITOR_SOURCE_TYPES } from "@/lib/monitoring/types";
import type { CreateMonitorPayload } from "@/components/monitoring/api";
import {
  SOURCE_TYPE_LABELS,
  FREQUENCY_OPTIONS,
} from "@/components/monitoring/labels";

interface MonitorFormProps {
  form: CreateMonitorPayload;
  submitting: boolean;
  formError: string | null;
  onChange: (updater: (f: CreateMonitorPayload) => CreateMonitorPayload) => void;
  onToggleSource: (source: MonitorSourceType) => void;
  onSubmit: (e: React.FormEvent) => void;
}

// Create-monitor form. Purely presentational: state and submission live in the page.
export function MonitorForm({
  form,
  submitting,
  formError,
  onChange,
  onToggleSource,
  onSubmit,
}: MonitorFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 bg-white border border-ink/15 rounded-lg p-5 space-y-4"
    >
      <label className="block">
        <span className="text-sm text-ink/60">Name</span>
        <input
          value={form.name}
          onChange={(e) => onChange((f) => ({ ...f, name: e.target.value }))}
          required
          className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          placeholder="e.g. Drug X hepatotoxicity"
        />
      </label>

      <label className="block">
        <span className="text-sm text-ink/60">Query</span>
        <textarea
          value={form.query}
          onChange={(e) => onChange((f) => ({ ...f, query: e.target.value }))}
          required
          rows={2}
          className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          placeholder="Adverse events or safety signals to watch for..."
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <span className="text-sm text-ink/60">Sources</span>
          <div className="mt-1 flex flex-wrap gap-3">
            {MONITOR_SOURCE_TYPES.map((source) => (
              <label
                key={source}
                className="flex items-center gap-2 text-sm text-ink/70"
              >
                <input
                  type="checkbox"
                  checked={form.sources.includes(source)}
                  onChange={() => onToggleSource(source)}
                />
                {SOURCE_TYPE_LABELS[source]}
              </label>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="text-sm text-ink/60">Frequency</span>
          <select
            value={form.frequency}
            onChange={(e) =>
              onChange((f) => ({
                ...f,
                frequency: e.target.value as MonitorFrequency,
              }))
            }
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          >
            {FREQUENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink/70">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => onChange((f) => ({ ...f, enabled: e.target.checked }))}
        />
        Enabled
      </label>

      {formError ? <p className="text-sm text-red-600">{formError}</p> : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={
            submitting ||
            form.name.trim().length === 0 ||
            form.query.trim().length === 0
          }
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Create monitor"}
        </button>
      </div>
    </form>
  );
}

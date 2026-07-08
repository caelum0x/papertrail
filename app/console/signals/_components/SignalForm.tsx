import type { AeSeverity, AeStatus } from "@/lib/monitoring/types";
import type { CreateSignalPayload } from "@/components/monitoring/api";
import {
  SEVERITY_OPTIONS,
  AE_STATUS_OPTIONS,
} from "@/components/monitoring/labels";

interface SignalFormProps {
  form: CreateSignalPayload;
  notes: string;
  submitting: boolean;
  formError: string | null;
  onChange: (updater: (f: CreateSignalPayload) => CreateSignalPayload) => void;
  onNotesChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

// Raise-signal form. Presentational only; page owns state and submission.
export function SignalForm({
  form,
  notes,
  submitting,
  formError,
  onChange,
  onNotesChange,
  onSubmit,
}: SignalFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 bg-white border border-ink/15 rounded-lg p-5 space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm text-ink/60">Drug</span>
          <input
            value={form.drug}
            onChange={(e) => onChange((f) => ({ ...f, drug: e.target.value }))}
            required
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
            placeholder="e.g. Drug X"
          />
        </label>
        <label className="block">
          <span className="text-sm text-ink/60">Event</span>
          <input
            value={form.event}
            onChange={(e) => onChange((f) => ({ ...f, event: e.target.value }))}
            required
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
            placeholder="e.g. Elevated liver enzymes"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm text-ink/60">Severity</span>
          <select
            value={form.severity}
            onChange={(e) =>
              onChange((f) => ({ ...f, severity: e.target.value as AeSeverity }))
            }
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-ink/60">Status</span>
          <select
            value={form.status}
            onChange={(e) =>
              onChange((f) => ({ ...f, status: e.target.value as AeStatus }))
            }
            className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          >
            {AE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-sm text-ink/60">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          placeholder="Context, source, or rationale..."
        />
      </label>

      {formError ? <p className="text-sm text-red-600">{formError}</p> : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={
            submitting ||
            form.drug.trim().length === 0 ||
            form.event.trim().length === 0
          }
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Raise signal"}
        </button>
      </div>
    </form>
  );
}

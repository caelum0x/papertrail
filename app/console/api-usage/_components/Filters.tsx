import { METHOD_OPTIONS } from "./shared";

export interface RequestFiltersValue {
  route: string;
  method: string;
  status: string;
}

interface FiltersProps {
  value: RequestFiltersValue;
  onChange: (next: RequestFiltersValue) => void;
  onReset: () => void;
}

// Filter bar for the request log: free-text route, method select, status select.
// Controlled — the page owns the value and refetches on change.
export function Filters({ value, onChange, onReset }: FiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-ink/15 bg-white p-3">
      <label className="flex flex-col gap-1 text-xs text-ink/40">
        Route
        <input
          type="text"
          value={value.route}
          placeholder="/api/v1/…"
          onChange={(e) => onChange({ ...value, route: e.target.value })}
          className="w-56 rounded-md border border-ink/15 px-2 py-1.5 text-sm text-ink/80"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink/40">
        Method
        <select
          value={value.method}
          onChange={(e) => onChange({ ...value, method: e.target.value })}
          className="rounded-md border border-ink/15 px-2 py-1.5 text-sm text-ink/80"
        >
          <option value="">Any</option>
          {METHOD_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink/40">
        Status
        <select
          value={value.status}
          onChange={(e) => onChange({ ...value, status: e.target.value })}
          className="rounded-md border border-ink/15 px-2 py-1.5 text-sm text-ink/80"
        >
          <option value="all">All</option>
          <option value="success">Success (2xx/3xx)</option>
          <option value="errors">Errors (4xx/5xx)</option>
        </select>
      </label>

      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
      >
        Reset
      </button>
    </div>
  );
}

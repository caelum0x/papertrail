"use client";

interface SaveDashboardFormProps {
  name: string;
  saving: boolean;
  saveError: string | null;
  onNameChange: (name: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

// Inline form to name and persist the current analytics view as a dashboard.
export function SaveDashboardForm({
  name,
  saving,
  saveError,
  onNameChange,
  onSubmit,
}: SaveDashboardFormProps) {
  return (
    <>
      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-ink/60">
          Name
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Q3 efficacy review"
            className="rounded-md border border-ink/10 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm font-medium text-ink/80 hover:bg-paper disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save dashboard"}
        </button>
      </form>
      {saveError ? <p className="mt-2 text-xs text-red-700">{saveError}</p> : null}
    </>
  );
}

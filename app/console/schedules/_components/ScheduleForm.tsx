interface ScheduleFormProps {
  name: string;
  type: string;
  cron: string;
  payload: string;
  creating: boolean;
  notice: string | null;
  onNameChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onCronChange: (value: string) => void;
  onPayloadChange: (value: string) => void;
  onCreate: () => void;
}

// Create-a-schedule field group: name, job type, cron and JSON payload.
export function ScheduleForm({
  name,
  type,
  cron,
  payload,
  creating,
  notice,
  onNameChange,
  onTypeChange,
  onCronChange,
  onPayloadChange,
  onCreate,
}: ScheduleFormProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink/80">Create a schedule</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Name
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
            placeholder="Nightly refresh"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Job type
          <input
            value={type}
            onChange={(e) => onTypeChange(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
            placeholder="noop"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Cron (UTC)
          <input
            value={cron}
            onChange={(e) => onCronChange(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 font-mono text-xs text-ink/80 focus:border-accent focus:outline-none"
            placeholder="0 * * * *"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Payload (JSON)
          <input
            value={payload}
            onChange={(e) => onPayloadChange(e.target.value)}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 font-mono text-xs text-ink/80 focus:border-accent focus:outline-none"
            placeholder="{}"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={onCreate}
          disabled={creating || !name.trim() || !type.trim() || !cron.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create schedule"}
        </button>
        {notice ? <p className="text-sm text-ink/60">{notice}</p> : null}
      </div>
    </div>
  );
}

interface EnqueueFormProps {
  type: string;
  payload: string;
  enqueuing: boolean;
  notice: string | null;
  onTypeChange: (value: string) => void;
  onPayloadChange: (value: string) => void;
  onEnqueue: () => void;
}

// Enqueue-a-job field group: type, JSON payload, and the submit action.
export function EnqueueForm({
  type,
  payload,
  enqueuing,
  notice,
  onTypeChange,
  onPayloadChange,
  onEnqueue,
}: EnqueueFormProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink/80">Enqueue a job</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Type
          <input
            value={type}
            onChange={(e) => onTypeChange(e.target.value)}
            className="w-48 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
            placeholder="noop"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-ink/60">
          Payload (JSON)
          <input
            value={payload}
            onChange={(e) => onPayloadChange(e.target.value)}
            className="min-w-[16rem] rounded-md border border-ink/15 bg-white px-2 py-1.5 font-mono text-xs text-ink/80 focus:border-accent focus:outline-none"
            placeholder="{}"
          />
        </label>
        <button
          onClick={onEnqueue}
          disabled={enqueuing || !type.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {enqueuing ? "Enqueuing…" : "Enqueue"}
        </button>
      </div>
      {notice ? <p className="mt-3 text-sm text-ink/60">{notice}</p> : null}
    </div>
  );
}

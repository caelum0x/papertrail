interface AttachClaimsProps {
  value: string;
  attaching: boolean;
  message: string | null;
  onChange: (value: string) => void;
  onAttach: () => void;
}

// Attach-claims panel: an id input plus the attach action and result message.
export function AttachClaims({
  value,
  attaching,
  message,
  onChange,
  onAttach,
}: AttachClaimsProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/15 bg-white p-6">
      <h2 className="text-sm font-medium text-ink/70">Attach claims</h2>
      <p className="mt-1 text-sm text-ink/40">
        Paste verified claim ids (comma or whitespace separated). Only claims in
        this org are attached.
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="claim id(s)…"
          className="min-w-0 flex-1 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
        <button
          onClick={onAttach}
          disabled={attaching}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {attaching ? "Attaching..." : "Attach"}
        </button>
      </div>
      {message ? <p className="mt-2 text-sm text-ink/60">{message}</p> : null}
    </div>
  );
}

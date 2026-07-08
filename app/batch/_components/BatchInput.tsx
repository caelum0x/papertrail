interface BatchInputProps {
  text: string;
  onTextChange: (value: string) => void;
  loading: boolean;
  detectedCount: number;
  maxBatch: number;
  onVerify: () => void;
}

export function BatchInput({
  text,
  onTextChange,
  loading,
  detectedCount,
  maxBatch,
  onVerify,
}: BatchInputProps) {
  return (
    <div className="max-w-2xl">
      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={8}
        placeholder="Paste a passage here. For example: “In our Phase 3 trial, the drug reduced major cardiovascular events by 45%. It was well tolerated across all age groups…”"
        className="w-full rounded-lg border border-ink/15 bg-white p-3 text-sm text-ink/80 placeholder:text-ink/30 focus:border-accent focus:outline-none"
        disabled={loading}
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-xs text-ink/50">
          {detectedCount === 0
            ? "No claims detected yet"
            : `${detectedCount} claim${detectedCount === 1 ? "" : "s"} detected (max ${maxBatch} will be checked)`}
        </span>
        <button
          onClick={onVerify}
          disabled={loading || detectedCount === 0}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Verifying…" : "Verify claims"}
        </button>
      </div>
    </div>
  );
}

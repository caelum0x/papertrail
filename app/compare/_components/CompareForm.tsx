interface CompareFormProps {
  claim: string;
  onClaimChange: (value: string) => void;
  sourceText: string;
  onSourceTextChange: (value: string) => void;
  loading: boolean;
  canSubmit: boolean;
  onVerify: () => void;
}

export function CompareForm({
  claim,
  onClaimChange,
  sourceText,
  onSourceTextChange,
  loading,
  canSubmit,
  onVerify,
}: CompareFormProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col">
          <label htmlFor="claim" className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">
            Claim to verify
          </label>
          <textarea
            id="claim"
            value={claim}
            onChange={(e) => onClaimChange(e.target.value)}
            disabled={loading}
            rows={5}
            placeholder="e.g. Drug X reduced major cardiovascular events by 30% in all patients."
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 placeholder:text-ink/35 focus:border-accent/50 focus:outline-none disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col">
          <label htmlFor="source" className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">
            Source text
          </label>
          <textarea
            id="source"
            value={sourceText}
            onChange={(e) => onSourceTextChange(e.target.value)}
            disabled={loading}
            rows={12}
            placeholder="Paste the abstract, results section, or trial record you want to check the claim against."
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 placeholder:text-ink/35 focus:border-accent/50 focus:outline-none disabled:opacity-50"
          />
        </div>
      </div>

      <div className="mt-4">
        <button
          onClick={onVerify}
          disabled={!canSubmit}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40"
        >
          {loading ? "Verifying…" : "Verify against this source"}
        </button>
      </div>
    </>
  );
}

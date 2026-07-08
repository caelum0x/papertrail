// Claim-entry form used on a workflow detail page to launch a new run. State is
// owned by the parent page; this component is purely presentational.

interface RunWorkflowFormProps {
  claim: string;
  onClaimChange: (value: string) => void;
  onRun: () => void;
  running: boolean;
  error: string | null;
}

export function RunWorkflowForm({
  claim,
  onClaimChange,
  onRun,
  running,
  error,
}: RunWorkflowFormProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-6">
      <h2 className="text-sm font-medium text-ink/70">Run this workflow</h2>
      <p className="mt-1 text-sm text-ink/40">
        Enter a claim to verify. The pipeline runs each step and records a full
        trace.
      </p>
      <textarea
        value={claim}
        onChange={(e) => onClaimChange(e.target.value)}
        rows={3}
        placeholder="e.g. Drug X reduced cardiovascular events by 30% in adults over 65."
        className="mt-3 w-full rounded-md border border-ink/15 bg-white p-3 text-sm text-ink/80 focus:border-accent focus:outline-none"
      />
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <button
        onClick={onRun}
        disabled={running || claim.trim().length < 3}
        className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {running ? "Running..." : "Run workflow"}
      </button>
    </div>
  );
}

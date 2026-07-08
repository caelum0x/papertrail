import { DISCREPANCY_OPTIONS } from "../lib";

// Labeled-case entry form for an eval set. State owned by the parent page.

interface AddCaseFormProps {
  claim: string;
  sourceExternalId: string;
  expectedType: string;
  substrings: string;
  onClaimChange: (value: string) => void;
  onSourceChange: (value: string) => void;
  onExpectedTypeChange: (value: string) => void;
  onSubstringsChange: (value: string) => void;
  onAdd: () => void;
  adding: boolean;
}

export function AddCaseForm({
  claim,
  sourceExternalId,
  expectedType,
  substrings,
  onClaimChange,
  onSourceChange,
  onExpectedTypeChange,
  onSubstringsChange,
  onAdd,
  adding,
}: AddCaseFormProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink/80">Add a labeled case</h2>
      <div className="mt-3 grid gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Claim
          <textarea
            value={claim}
            onChange={(e) => onClaimChange(e.target.value)}
            rows={2}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
            placeholder="Drug X reduced major cardiac events by 30% in all adults."
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink/60">
            Expected discrepancy
            <select
              value={expectedType}
              onChange={(e) => onExpectedTypeChange(e.target.value)}
              className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
            >
              {DISCREPANCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink/60">
            Source id (PMID / NCT, optional)
            <input
              value={sourceExternalId}
              onChange={(e) => onSourceChange(e.target.value)}
              className="w-56 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
              placeholder="NCT01234567"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Expected source substrings (one per line, optional)
          <textarea
            value={substrings}
            onChange={(e) => onSubstringsChange(e.target.value)}
            rows={2}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5 font-mono text-xs text-ink/80 focus:border-accent focus:outline-none"
            placeholder="patients 65 and older&#10;secondary prevention"
          />
        </label>
        <div>
          <button
            onClick={onAdd}
            disabled={adding || claim.trim().length < 10}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {adding ? "Adding…" : "Add case"}
          </button>
        </div>
      </div>
    </div>
  );
}

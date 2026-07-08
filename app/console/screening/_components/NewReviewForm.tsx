// "New systematic review" form. State owned by the parent list page.

interface NewReviewFormProps {
  name: string;
  question: string;
  criteria: string;
  onNameChange: (value: string) => void;
  onQuestionChange: (value: string) => void;
  onCriteriaChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
  error: string | null;
}

export function NewReviewForm({
  name,
  question,
  criteria,
  onNameChange,
  onQuestionChange,
  onCriteriaChange,
  onSubmit,
  submitting,
  canSubmit,
  error,
}: NewReviewFormProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/15 bg-white p-6">
      <h2 className="text-sm font-medium text-ink/70">New systematic review</h2>
      <div className="mt-4 space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wide text-ink/40">
            Name
          </label>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. GLP-1 agonists and cardiovascular outcomes"
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-ink/40">
            Research question
          </label>
          <textarea
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            rows={2}
            placeholder="What question does this review answer?"
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-ink/40">
            Inclusion criteria (one per line)
          </label>
          <textarea
            value={criteria}
            onChange={(e) => onCriteriaChange(e.target.value)}
            rows={3}
            placeholder={"RCTs only\nAdults ≥ 18\nEnglish language"}
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
          />
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <button
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Creating..." : "Create review"}
        </button>
      </div>
    </div>
  );
}

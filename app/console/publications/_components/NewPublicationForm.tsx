import type { PublicationType } from "@/app/api/publications/lib/types";

const TYPES: { value: PublicationType; label: string }[] = [
  { value: "manuscript", label: "Manuscript" },
  { value: "abstract", label: "Abstract" },
  { value: "poster", label: "Poster" },
  { value: "slide_deck", label: "Slide deck" },
  { value: "other", label: "Other" },
];

interface NewPublicationFormProps {
  title: string;
  type: PublicationType;
  targetJournal: string;
  submitting: boolean;
  error: string | null;
  onTitleChange: (value: string) => void;
  onTypeChange: (value: PublicationType) => void;
  onTargetJournalChange: (value: string) => void;
  onSubmit: () => void;
}

// Field group for creating a publication. State lives in the page.
export function NewPublicationForm({
  title,
  type,
  targetJournal,
  submitting,
  error,
  onTitleChange,
  onTypeChange,
  onTargetJournalChange,
  onSubmit,
}: NewPublicationFormProps) {
  const canSubmit = title.trim().length > 0;
  return (
    <div className="mt-6 space-y-4 rounded-lg border border-ink/15 bg-white p-6">
      <div>
        <label className="text-xs uppercase tracking-wide text-ink/40">
          Title
        </label>
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="e.g. Efficacy of Drug X in reducing cardiovascular events"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="text-xs uppercase tracking-wide text-ink/40">
          Type
        </label>
        <select
          value={type}
          onChange={(e) => onTypeChange(e.target.value as PublicationType)}
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs uppercase tracking-wide text-ink/40">
          Target journal / venue (optional)
        </label>
        <input
          value={targetJournal}
          onChange={(e) => onTargetJournalChange(e.target.value)}
          placeholder="e.g. New England Journal of Medicine"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? "Creating..." : "Create publication"}
      </button>
    </div>
  );
}

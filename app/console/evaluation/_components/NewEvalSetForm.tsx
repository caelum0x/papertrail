// Inline "new eval set" form. State owned by the parent page.

interface NewEvalSetFormProps {
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCreate: () => void;
  creating: boolean;
  notice: string | null;
}

export function NewEvalSetForm({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onCreate,
  creating,
  notice,
}: NewEvalSetFormProps) {
  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-4">
      <h2 className="text-sm font-medium text-ink/80">New eval set</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink/60">
          Name
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-64 rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
            placeholder="Cardiology efficacy claims"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-ink/60">
          Description (optional)
          <input
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            className="min-w-[16rem] rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
            placeholder="Regression set for the verification agent"
          />
        </label>
        <button
          onClick={onCreate}
          disabled={creating || !name.trim()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create set"}
        </button>
      </div>
      {notice ? <p className="mt-3 text-sm text-ink/60">{notice}</p> : null}
    </div>
  );
}

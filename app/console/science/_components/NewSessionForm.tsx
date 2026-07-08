// Inline "new research session" form. State is owned by the parent page.

interface NewSessionFormProps {
  title: string;
  onTitleChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  error: string | null;
}

export function NewSessionForm({
  title,
  onTitleChange,
  onSubmit,
  submitting,
  error,
}: NewSessionFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 bg-white border border-ink/15 rounded-lg p-5 space-y-3"
    >
      <div>
        <label className="block text-sm text-ink/70 mb-1">Title</label>
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          maxLength={200}
          className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
          placeholder="e.g. GLP-1 cardiovascular outcomes review"
          autoFocus
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Creating..." : "Start session"}
      </button>
    </form>
  );
}

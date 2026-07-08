// Notes textarea + save control for the evidence detail page.

interface NotesEditorProps {
  notes: string;
  saving: boolean;
  dirty: boolean;
  onNotesChange: (value: string) => void;
  onSave: () => void;
}

export function NotesEditor({
  notes,
  saving,
  dirty,
  onNotesChange,
  onSave,
}: NotesEditorProps) {
  return (
    <section className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">Notes</h2>
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        rows={5}
        className="mt-3 w-full rounded border border-ink/15 px-3 py-2 text-sm focus:outline-none focus:border-accent"
        placeholder="Add context about this source..."
      />
      <div className="mt-3 flex justify-end">
        <button
          onClick={onSave}
          disabled={saving || !dirty}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save notes"}
        </button>
      </div>
    </section>
  );
}

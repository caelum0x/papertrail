import type { FormEvent } from "react";

// Controlled create-project form. Presentational: state and submit handler live
// in the parent page so the list can refresh after a successful create.

interface NewProjectFormProps {
  name: string;
  description: string;
  submitting: boolean;
  error: string | null;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function NewProjectForm({
  name,
  description,
  submitting,
  error,
  onNameChange,
  onDescriptionChange,
  onSubmit,
}: NewProjectFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 bg-white border border-ink/15 rounded-lg p-5 space-y-3"
    >
      <div>
        <label className="block text-sm text-ink/70 mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={200}
          className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
          placeholder="e.g. Cardio Efficacy Review"
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm text-ink/70 mb-1">
          Description <span className="text-ink/35">(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          maxLength={2000}
          rows={3}
          className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
          placeholder="What is this workspace for?"
        />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Creating..." : "Create project"}
      </button>
    </form>
  );
}

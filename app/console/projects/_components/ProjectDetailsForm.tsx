import type { FormEvent } from "react";
import type { ProjectStatus } from "@/components/projects/types";

// Editable project details (name, description, status) used on the settings page.

interface ProjectDetailsFormProps {
  name: string;
  description: string;
  status: ProjectStatus;
  saving: boolean;
  message: string | null;
  error: string | null;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onStatusChange: (value: ProjectStatus) => void;
  onSubmit: (e: FormEvent) => void;
}

export function ProjectDetailsForm({
  name,
  description,
  status,
  saving,
  message,
  error,
  onNameChange,
  onDescriptionChange,
  onStatusChange,
  onSubmit,
}: ProjectDetailsFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 bg-white border border-ink/15 rounded-lg p-5 space-y-3"
    >
      <h2 className="text-sm font-medium text-ink/70">Details</h2>
      <div>
        <label className="block text-sm text-ink/70 mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={200}
          className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-sm text-ink/70 mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          maxLength={2000}
          rows={3}
          className="w-full text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-sm text-ink/70 mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => onStatusChange(e.target.value as ProjectStatus)}
          className="text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-accent">{message}</p> : null}
      <button
        type="submit"
        disabled={saving}
        className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save changes"}
      </button>
    </form>
  );
}

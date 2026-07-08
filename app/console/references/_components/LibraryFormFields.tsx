"use client";

interface LibraryFormFieldsProps {
  name: string;
  projectId: string;
  onNameChange: (value: string) => void;
  onProjectIdChange: (value: string) => void;
}

// Field group for the create-library form: name (required) + optional project id.
export function LibraryFormFields({
  name,
  projectId,
  onNameChange,
  onProjectIdChange,
}: LibraryFormFieldsProps) {
  return (
    <>
      <div>
        <label htmlFor="lib-name" className="block text-sm font-medium text-ink/70">
          Name <span className="text-accent">*</span>
        </label>
        <input
          id="lib-name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={200}
          required
          autoFocus
          placeholder="e.g. Cardiovascular Efficacy Sources"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="project-id" className="block text-sm font-medium text-ink/70">
          Project ID <span className="text-ink/40">(optional)</span>
        </label>
        <input
          id="project-id"
          type="text"
          value={projectId}
          onChange={(e) => onProjectIdChange(e.target.value)}
          placeholder="Associate with a project (UUID)"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/80 focus:border-accent focus:outline-none"
        />
      </div>
    </>
  );
}

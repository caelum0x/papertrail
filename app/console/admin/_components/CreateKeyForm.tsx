"use client";

interface CreateKeyFormProps {
  name: string;
  creating: boolean;
  error: string | null;
  onNameChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

// Form for creating a new API key by name.
export function CreateKeyForm({
  name,
  creating,
  error,
  onNameChange,
  onSubmit,
}: CreateKeyFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 bg-white border border-ink/15 rounded-lg p-5"
    >
      <h2 className="text-sm font-medium text-ink/70">Create a key</h2>
      <div className="mt-3 flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. CI pipeline"
          maxLength={80}
          className="flex-1 text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
          aria-label="API key name"
        />
        <button
          type="submit"
          disabled={creating}
          className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {creating ? "Creating..." : "Create key"}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </form>
  );
}

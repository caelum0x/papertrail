"use client";

import { useCallback, useState } from "react";

interface ApiKeyFormProps {
  creating: boolean;
  createError: string | null;
  onCreate: (name: string) => void;
}

// The "Create a key" form: a name input + submit button with inline error. Owns
// only its transient input value; creation state is driven by the parent hook.
export function ApiKeyForm({ creating, createError, onCreate }: ApiKeyFormProps) {
  const [name, setName] = useState("");

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onCreate(name);
      setName("");
    },
    [name, onCreate]
  );

  return (
    <form
      onSubmit={onSubmit}
      className="mt-4 bg-white border border-ink/15 rounded-lg p-5"
    >
      <h3 className="text-sm font-medium text-ink/70">Create a key</h3>
      <div className="mt-3 flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production integration"
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
      {createError ? (
        <p className="mt-2 text-sm text-red-600">{createError}</p>
      ) : null}
    </form>
  );
}

"use client";

import { useState } from "react";

interface CreateCardProps {
  creating: boolean;
  error: string | null;
  onCreate: (name: string, isDefault: boolean) => void;
}

// Inline create form for a new dashboard, rendered above the list.
export function CreateCard({ creating, error, onCreate }: CreateCardProps) {
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, isDefault);
    setName("");
    setIsDefault(false);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-lg border border-ink/15 bg-white p-4"
    >
      <h2 className="text-sm font-semibold text-ink/70">New dashboard</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[200px]">
          <span className="mb-1 block text-xs text-ink/50">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Efficacy overview"
            maxLength={120}
            className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink/60">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Set as default
        </label>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </form>
  );
}

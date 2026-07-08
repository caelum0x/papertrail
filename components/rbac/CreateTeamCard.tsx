"use client";

import { useCallback, useState } from "react";
import { apiSend, type TeamDTO } from "./api";

// Inline create-team form rendered as the first tile in the TeamsGrid. On
// success it notifies the parent so the grid can refresh.
export function CreateTeamCard({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName("");
    setDescription("");
    setError(null);
    setOpen(false);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (name.trim().length < 2) {
        setError("Name must be at least 2 characters.");
        return;
      }
      setSaving(true);
      setError(null);
      const res = await apiSend<TeamDTO>("/api/teams", "POST", {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setSaving(false);
      if (!res.success) {
        setError(res.error ?? "Failed to create team.");
        return;
      }
      reset();
      onCreated();
    },
    [description, name, onCreated, reset]
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[7rem] items-center justify-center rounded-lg border border-dashed border-ink/20 bg-paper text-sm font-medium text-ink/60 transition hover:border-accent/40 hover:text-accent"
      >
        + New team
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-ink/10 bg-white p-4"
    >
      {error ? (
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {error}
        </div>
      ) : null}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Team name"
        maxLength={80}
        autoFocus
        className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        maxLength={280}
        className="mt-2 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-paper"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

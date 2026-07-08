"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiSend, type TeamDTO } from "./api";

// DETAIL header: shows the team name/description and offers rename + delete.
export function TeamHeader({
  team,
  onUpdated,
}: {
  team: TeamDTO;
  onUpdated: (team: TeamDTO) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (name.trim().length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await apiSend<TeamDTO>(`/api/teams/${team.id}`, "PATCH", {
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
    });
    setSaving(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to update team.");
      return;
    }
    onUpdated(res.data);
    setEditing(false);
  }, [description, name, onUpdated, team.id]);

  const handleDelete = useCallback(async () => {
    if (!window.confirm(`Delete the team "${team.name}"? This cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    const res = await apiSend(`/api/teams/${team.id}`, "DELETE");
    setDeleting(false);
    if (!res.success) {
      setError(res.error ?? "Failed to delete team.");
      return;
    }
    router.push("/console/teams");
    router.refresh();
  }, [router, team.id, team.name]);

  return (
    <div className="mb-6">
      <Link href="/console/teams" className="text-sm text-accent hover:underline">
        ← Back to teams
      </Link>

      {error ? (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {editing ? (
        <div className="mt-3 max-w-md space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            maxLength={280}
            className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(team.name);
                setDescription(team.description ?? "");
                setError(null);
              }}
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-paper"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink/80">{team.name}</h1>
            <p className="mt-1 text-sm text-ink/40">
              {team.description || "No description."} ·{" "}
              {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-paper"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

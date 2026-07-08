"use client";

import { useCallback, useState } from "react";
import { apiSend, type AssignableMemberDTO, type TeamMemberDTO } from "./api";

// Adds an existing org member (chosen from the assignable list) to the team.
export function AddMemberForm({
  teamId,
  assignable,
  onAdded,
}: {
  teamId: string;
  assignable: AssignableMemberDTO[];
  onAdded: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!userId) {
        setError("Select a member to add.");
        return;
      }
      setSaving(true);
      setError(null);
      const res = await apiSend<TeamMemberDTO>(
        `/api/teams/${teamId}/members`,
        "POST",
        { userId }
      );
      setSaving(false);
      if (!res.success) {
        setError(res.error ?? "Failed to add member.");
        return;
      }
      setUserId("");
      onAdded();
    },
    [onAdded, teamId, userId]
  );

  if (assignable.length === 0) {
    return (
      <p className="text-sm text-ink/40">
        All organization members are already on this team.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <select
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className="rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
      >
        <option value="">Select a member…</option>
        {assignable.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name ? `${m.name} (${m.email})` : m.email}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={saving || !userId}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
      >
        {saving ? "Adding…" : "Add member"}
      </button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </form>
  );
}

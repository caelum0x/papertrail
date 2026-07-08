import type { FormEvent } from "react";
import type { ProjectMember } from "@/components/projects/types";

const ROLE_OPTIONS: ProjectMember["role"][] = [
  "owner",
  "admin",
  "editor",
  "viewer",
];

// Inline form for adding an existing org user to the project.

interface AddMemberFormProps {
  userId: string;
  role: ProjectMember["role"];
  adding: boolean;
  error: string | null;
  onUserIdChange: (value: string) => void;
  onRoleChange: (value: ProjectMember["role"]) => void;
  onSubmit: (e: FormEvent) => void;
}

export function AddMemberForm({
  userId,
  role,
  adding,
  error,
  onUserIdChange,
  onRoleChange,
  onSubmit,
}: AddMemberFormProps) {
  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-2">
      <label className="block text-sm text-ink/70">Add member</label>
      <div className="flex gap-2">
        <input
          value={userId}
          onChange={(e) => onUserIdChange(e.target.value)}
          placeholder="User id (uuid)"
          className="flex-1 text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
        />
        <select
          value={role}
          onChange={(e) => onRoleChange(e.target.value as ProjectMember["role"])}
          className="text-sm border border-ink/15 rounded px-2 py-2 focus:outline-none focus:border-accent"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={adding}
          className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90 disabled:opacity-50"
        >
          {adding ? "Adding..." : "Add"}
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <p className="text-xs text-ink/35">
        The user must already be a member of this organization.
      </p>
    </form>
  );
}

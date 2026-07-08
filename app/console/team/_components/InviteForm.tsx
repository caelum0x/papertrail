"use client";

import { ROLE_OPTIONS } from "./types";

interface InviteFormProps {
  email: string;
  role: string;
  submitting: boolean;
  error: string | null;
  notice: string | null;
  onEmailChange: (value: string) => void;
  onRoleChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

// Invite-a-member form: email + role fields with inline error/notice states.
export function InviteForm({
  email,
  role,
  submitting,
  error,
  notice,
  onEmailChange,
  onRoleChange,
  onSubmit,
}: InviteFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="mt-6 bg-white border border-ink/15 rounded-lg p-5"
    >
      <h2 className="text-sm font-medium text-ink/70">Invite a member</h2>
      <div className="mt-3 flex flex-col sm:flex-row gap-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="colleague@lab.org"
          className="flex-1 text-sm border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
          aria-label="Invite email"
        />
        <select
          value={role}
          onChange={(e) => onRoleChange(e.target.value)}
          className="text-sm border border-ink/15 rounded px-2 py-2 focus:outline-none focus:border-accent capitalize"
          aria-label="Invite role"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r} className="capitalize">
              {r}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={submitting}
          className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {submitting ? "Sending..." : "Send invite"}
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {notice ? <p className="mt-2 text-sm text-ink/60">{notice}</p> : null}
    </form>
  );
}

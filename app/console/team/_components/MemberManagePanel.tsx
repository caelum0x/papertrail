"use client";

import { ROLE_OPTIONS, type Member } from "./types";

interface MemberManagePanelProps {
  member: Member;
  myRole: string | null;
  roleDraft: string;
  saving: boolean;
  notice: string | null;
  actionError: string | null;
  onRoleDraftChange: (value: string) => void;
  onSaveRole: () => void;
  onRemove: () => void;
}

// Management controls for a member: change-role form and remove-from-org
// section. Only an owner may assign/revoke the owner role.
export function MemberManagePanel({
  member,
  myRole,
  roleDraft,
  saving,
  notice,
  actionError,
  onRoleDraftChange,
  onSaveRole,
  onRemove,
}: MemberManagePanelProps) {
  const roleChoices =
    myRole === "owner"
      ? ROLE_OPTIONS
      : ROLE_OPTIONS.filter((r) => r !== "owner");

  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">Change role</h2>
      <div className="mt-3 flex items-center gap-3">
        <select
          value={roleDraft}
          onChange={(e) => onRoleDraftChange(e.target.value)}
          className="text-sm border border-ink/15 rounded px-2 py-2 focus:outline-none focus:border-accent capitalize"
          aria-label="Member role"
        >
          {roleChoices.map((r) => (
            <option key={r} value={r} className="capitalize">
              {r}
            </option>
          ))}
        </select>
        <button
          onClick={onSaveRole}
          disabled={saving || roleDraft === member.role}
          className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {notice ? <p className="mt-2 text-sm text-ink/60">{notice}</p> : null}

      <div className="mt-6 pt-5 border-t border-ink/10">
        <h2 className="text-sm font-medium text-ink/70">
          Remove from organization
        </h2>
        <p className="mt-1 text-sm text-ink/40">
          This revokes all access for this member.
        </p>
        <button
          onClick={onRemove}
          disabled={saving}
          className="mt-3 text-sm border border-red-600 text-red-600 rounded px-4 py-2 hover:bg-red-50 disabled:opacity-50"
        >
          Remove member
        </button>
      </div>

      {actionError ? (
        <p className="mt-3 text-sm text-red-600">{actionError}</p>
      ) : null}
    </div>
  );
}

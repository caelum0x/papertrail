"use client";

import { useCallback, useState } from "react";
import { StepShell } from "./StepShell";

// Third wizard step (optional). Admins can invite teammates to the org via the
// existing /api/invitations endpoint; non-admins see a note and can skip. Sending
// at least one invite (or skipping) advances the wizard.

const ORG_STORAGE_KEY = "pt_active_org";
const INVITE_ROLES = ["viewer", "editor", "admin"] as const;
type InviteRole = (typeof INVITE_ROLES)[number];

interface InviteStepProps {
  canInvite: boolean;
  onBack: () => void;
  onContinue: () => void;
  busy: boolean;
  error: string | null;
}

function orgHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof window !== "undefined") {
    const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
    if (orgId) headers["x-org-id"] = orgId;
  }
  return headers;
}

export function InviteStep({
  canInvite,
  onBack,
  onContinue,
  busy,
  error,
}: InviteStepProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string[]>([]);

  const onInvite = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = email.trim();
      if (!trimmed) return;
      setInviting(true);
      setInviteError(null);
      try {
        const res = await fetch("/api/invitations", {
          method: "POST",
          headers: orgHeaders(),
          body: JSON.stringify({ email: trimmed, role }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.success) {
          setInviteError(body?.error ?? "Failed to send invitation.");
          return;
        }
        setInvited((prev) => [...prev, trimmed]);
        setEmail("");
      } catch {
        setInviteError("Network error sending invitation.");
      } finally {
        setInviting(false);
      }
    },
    [email, role]
  );

  return (
    <StepShell
      title="Invite your team"
      blurb="Bring in collaborators to review and verify claims together. You can skip this and invite people later."
      onBack={onBack}
      primaryLabel="Continue"
      onPrimary={onContinue}
      primaryBusy={busy}
      secondaryLabel="Skip for now"
      onSecondary={onContinue}
      error={error}
    >
      {canInvite ? (
        <>
          <form onSubmit={onInvite} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1">
              <label
                htmlFor="invite-email"
                className="block text-sm text-ink/60"
              >
                Teammate email
              </label>
              <input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@lab.org"
                className="mt-1 w-full rounded border border-ink/10 px-3 py-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="invite-role" className="block text-sm text-ink/60">
                Role
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as InviteRole)}
                className="mt-1 rounded border border-ink/10 px-2 py-2 text-sm capitalize focus:border-accent focus:outline-none"
              >
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r} className="capitalize">
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={inviting || email.trim() === ""}
              className="rounded bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {inviting ? "Inviting…" : "Send invite"}
            </button>
          </form>
          {inviteError ? (
            <p className="mt-3 text-sm text-red-600">{inviteError}</p>
          ) : null}
          {invited.length > 0 ? (
            <ul className="mt-4 space-y-1">
              {invited.map((e) => (
                <li key={e} className="text-sm text-ink/60">
                  Invited {e}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-ink/60">
          Only owners and admins can invite teammates. You can skip this step and
          continue.
        </p>
      )}
    </StepShell>
  );
}

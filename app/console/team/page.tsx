"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, sendJson } from "@/components/org-team/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { TeamHeader } from "./_components/TeamHeader";
import { InviteForm } from "./_components/InviteForm";
import { MembersList } from "./_components/MembersList";
import { PendingInvitations } from "./_components/PendingInvitations";
import type { Member, Invitation } from "./_components/types";

export default function TeamPage() {
  const { canManage } = useCurrentRole();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("viewer");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const membersRes = await getJson<Member[]>("/api/members?limit=100");
      if (!membersRes.success || !membersRes.data) {
        setError(membersRes.error ?? "Failed to load members.");
        setLoading(false);
        return;
      }
      setMembers(membersRes.data);

      if (canManage) {
        const invRes = await getJson<Invitation[]>("/api/invitations?limit=100");
        if (invRes.success && invRes.data) {
          setInvitations(invRes.data.filter((i) => i.pending));
        }
      }
    } catch {
      setError("Failed to load team.");
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    load();
  }, [load]);

  const onInvite = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setInviting(true);
      setInviteError(null);
      setInviteNotice(null);
      const res = await sendJson<{ email?: string }>("/api/invitations", "POST", {
        email: inviteEmail,
        role: inviteRole,
      });
      setInviting(false);
      if (!res.success) {
        setInviteError(res.error ?? "Failed to send invitation.");
        return;
      }
      setInviteEmail("");
      setInviteRole("viewer");
      setInviteNotice("Invitation sent.");
      load();
    },
    [inviteEmail, inviteRole, load]
  );

  const onRevoke = useCallback(async (id: string) => {
    const res = await sendJson(`/api/invitations/${id}`, "DELETE");
    if (res.success) {
      setInvitations((prev) => prev.filter((i) => i.id !== id));
    }
  }, []);

  return (
    <div>
      <TeamHeader />

      {canManage ? (
        <InviteForm
          email={inviteEmail}
          role={inviteRole}
          submitting={inviting}
          error={inviteError}
          notice={inviteNotice}
          onEmailChange={setInviteEmail}
          onRoleChange={setInviteRole}
          onSubmit={onInvite}
        />
      ) : null}

      <MembersList members={members} loading={loading} error={error} />

      {canManage ? (
        <PendingInvitations
          invitations={invitations}
          loading={loading}
          onRevoke={onRevoke}
        />
      ) : null}
    </div>
  );
}

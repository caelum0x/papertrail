"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getJson, sendJson } from "@/components/org-team/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { MemberIdentity } from "../_components/MemberIdentity";
import { MemberManagePanel } from "../_components/MemberManagePanel";
import { MemberTabs } from "../_components/MemberTabs";
import type { Member } from "../_components/types";

export default function MemberDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const memberId = params?.id;
  const { canManage, role: myRole } = useCurrentRole();

  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [roleDraft, setRoleDraft] = useState<string>("viewer");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setError(null);
    const res = await getJson<Member>(`/api/members/${memberId}`);
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Member not found.");
      return;
    }
    setMember(res.data);
    setRoleDraft(res.data.role);
  }, [memberId]);

  useEffect(() => {
    load();
  }, [load]);

  const onSaveRole = useCallback(async () => {
    if (!memberId) return;
    setSaving(true);
    setActionError(null);
    setNotice(null);
    const res = await sendJson<Member>(`/api/members/${memberId}`, "PATCH", {
      role: roleDraft,
    });
    setSaving(false);
    if (!res.success || !res.data) {
      setActionError(res.error ?? "Failed to update role.");
      return;
    }
    setMember(res.data);
    setNotice("Role updated.");
  }, [memberId, roleDraft]);

  const onRemove = useCallback(async () => {
    if (!memberId) return;
    setSaving(true);
    setActionError(null);
    const res = await sendJson(`/api/members/${memberId}`, "DELETE");
    setSaving(false);
    if (!res.success) {
      setActionError(res.error ?? "Failed to remove member.");
      return;
    }
    router.push("/console/team");
  }, [memberId, router]);

  return (
    <div className="max-w-2xl">
      <Link href="/console/team" className="text-sm text-accent hover:underline">
        ← Back to team
      </Link>

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading member...</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : member ? (
        <div className="mt-4">
          <MemberIdentity member={member} />
          {memberId ? <MemberTabs memberId={memberId} active="overview" /> : null}

          {canManage ? (
            <MemberManagePanel
              member={member}
              myRole={myRole}
              roleDraft={roleDraft}
              saving={saving}
              notice={notice}
              actionError={actionError}
              onRoleDraftChange={setRoleDraft}
              onSaveRole={onSaveRole}
              onRemove={onRemove}
            />
          ) : (
            <p className="mt-6 text-sm text-ink/40">
              You do not have permission to manage this member.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getJson } from "@/components/org-team/apiClient";
import { useCurrentRole } from "@/components/org-team/useCurrentRole";
import { MemberIdentity } from "../../_components/MemberIdentity";
import { MemberTabs } from "../../_components/MemberTabs";
import type { Member } from "../../_components/types";

interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userName: string | null;
  userEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface AuditListResponse {
  entries: AuditLogEntry[];
  filters: unknown;
}

const PAGE_SIZE = 25;

// Member activity sub-page: shows this member's recent audit-trail actions by
// filtering the existing /api/audit endpoint on userId. Admin+ only, mirroring
// the audit log's own access rules.
export default function MemberActivityPage() {
  const params = useParams<{ id: string }>();
  const memberId = params?.id;
  const { canManage, loading: roleLoading } = useCurrentRole();

  const [member, setMember] = useState<Member | null>(null);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setError(null);

    const memberRes = await getJson<Member>(`/api/members/${memberId}`);
    if (!memberRes.success || !memberRes.data) {
      setError(memberRes.error ?? "Member not found.");
      setLoading(false);
      return;
    }
    setMember(memberRes.data);

    const query = new URLSearchParams({
      userId: memberRes.data.userId,
      limit: String(PAGE_SIZE),
      page: "1",
    }).toString();
    const auditRes = await getJson<AuditListResponse>(`/api/audit?${query}`);
    if (!auditRes.success || !auditRes.data) {
      setError(auditRes.error ?? "Failed to load activity.");
      setLoading(false);
      return;
    }
    setEntries(auditRes.data.entries);
    setLoading(false);
  }, [memberId]);

  useEffect(() => {
    if (!roleLoading && canManage) load();
    else if (!roleLoading) setLoading(false);
  }, [roleLoading, canManage, load]);

  return (
    <div className="max-w-2xl">
      <Link href="/console/team" className="text-sm text-accent hover:underline">
        ← Back to team
      </Link>

      {!roleLoading && !canManage ? (
        <p className="mt-6 text-sm text-ink/60">
          You need an admin or owner role to view member activity.
        </p>
      ) : loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading activity...</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : member ? (
        <div className="mt-4">
          <MemberIdentity member={member} />
          {memberId ? <MemberTabs memberId={memberId} active="activity" /> : null}

          <div className="mt-6 bg-white border border-ink/10 rounded-lg overflow-hidden">
            <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
              Recent activity
            </div>
            {entries.length === 0 ? (
              <div className="p-5 text-sm text-ink/40">
                No recorded activity for this member yet.
              </div>
            ) : (
              <ul className="divide-y divide-ink/10">
                {entries.map((entry) => (
                  <li key={entry.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-sm text-ink/80">
                          <span className="font-medium">{entry.action}</span>
                          <span className="text-ink/40">
                            {" "}
                            · {entry.entityType}
                          </span>
                        </div>
                        {entry.entityId ? (
                          <div className="text-xs text-ink/40 truncate">
                            {entry.entityId}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-xs text-ink/40 shrink-0 tabular-nums">
                        {new Date(entry.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

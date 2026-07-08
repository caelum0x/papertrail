"use client";

import { useCallback, useState } from "react";
import { apiSend, type TeamMemberDTO } from "./api";
import { MemberRow } from "./MemberRow";
import { EmptyState } from "./EmptyState";

// DETAIL panel: the team's members table with inline removal. Membership data
// is owned by the parent (TeamDetail) so add/remove refresh the shared view.
export function MembersTable({
  teamId,
  members,
  onChanged,
}: {
  teamId: string;
  members: TeamMemberDTO[];
  onChanged: () => void;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = useCallback(
    async (member: TeamMemberDTO) => {
      if (
        !window.confirm(
          `Remove ${member.userName || member.userEmail} from this team?`
        )
      ) {
        return;
      }
      setRemovingId(member.userId);
      setError(null);
      const res = await apiSend(
        `/api/teams/${teamId}/members?userId=${encodeURIComponent(member.userId)}`,
        "DELETE"
      );
      setRemovingId(null);
      if (!res.success) {
        setError(res.error ?? "Failed to remove member.");
        return;
      }
      onChanged();
    },
    [onChanged, teamId]
  );

  return (
    <section className="rounded-lg border border-ink/10 bg-white">
      <div className="border-b border-ink/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink/70">Members</h2>
      </div>

      {error ? (
        <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {members.length === 0 ? (
        <div className="p-4">
          <EmptyState
            title="No members yet"
            description="Add organization members to this team using the form above."
          />
        </div>
      ) : (
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-ink/60">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Added</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  removing={removingId === member.userId}
                  onRemove={handleRemove}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

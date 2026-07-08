import Link from "next/link";
import { RoleBadge } from "@/components/org-team/RoleBadge";
import type { Member } from "./types";

interface MemberRowProps {
  member: Member;
}

// A single member row: name/email plus role badge and a manage link.
function MemberRow({ member }: MemberRowProps) {
  return (
    <li className="px-5 py-3 flex items-center justify-between">
      <div className="min-w-0">
        <div className="text-sm text-ink/80 truncate">
          {member.name ?? member.email}
        </div>
        <div className="text-xs text-ink/40 truncate">{member.email}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <RoleBadge role={member.role} />
        <Link
          href={`/console/team/${member.id}`}
          className="text-xs text-accent hover:underline"
        >
          Manage
        </Link>
      </div>
    </li>
  );
}

interface MembersListProps {
  members: Member[];
  loading: boolean;
  error: string | null;
}

// Card listing the organization's members, with loading/error/empty states.
export function MembersList({ members, loading, error }: MembersListProps) {
  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
        Members
      </div>
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading members...</div>
      ) : error ? (
        <div className="p-5 text-sm text-red-600">{error}</div>
      ) : members.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">No members yet.</div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

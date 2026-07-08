import { RoleBadge } from "@/components/org-team/RoleBadge";
import type { Member } from "./types";

interface MemberIdentityProps {
  member: Member;
}

// Name, role badge, email, and join date for a member detail view.
export function MemberIdentity({ member }: MemberIdentityProps) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-ink/80">
          {member.name ?? member.email}
        </h1>
        <RoleBadge role={member.role} />
      </div>
      <p className="mt-1 text-sm text-ink/40">{member.email}</p>
      <p className="mt-1 text-xs text-ink/35">
        Joined {new Date(member.joinedAt).toLocaleDateString()}
      </p>
    </div>
  );
}

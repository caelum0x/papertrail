import Link from "next/link";
import type { ProjectMember } from "@/components/projects/types";
import { MembersList } from "./MembersList";

// Dashboard card summarizing project members, with a link to manage them in
// settings when the roster is empty.

interface MembersCardProps {
  projectId: string;
  members: ProjectMember[];
}

export function MembersCard({ projectId, members }: MembersCardProps) {
  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg p-5">
      <h2 className="text-sm font-medium text-ink/70">
        Members <span className="text-ink/35">({members.length})</span>
      </h2>
      {members.length === 0 ? (
        <p className="mt-2 text-sm text-ink/40">
          No members added yet. Manage members in{" "}
          <Link
            href={`/console/projects/${projectId}/settings`}
            className="text-accent"
          >
            settings
          </Link>
          .
        </p>
      ) : (
        <MembersList members={members} />
      )}
    </div>
  );
}

import type { ProjectMember } from "@/components/projects/types";

// Read-only members roster. Optionally shows each member's email under the name
// (used on the settings page where the extra detail is helpful).

interface MembersListProps {
  members: ProjectMember[];
  showEmail?: boolean;
}

export function MembersList({ members, showEmail = false }: MembersListProps) {
  return (
    <ul className="mt-3 divide-y divide-ink/10">
      {members.map((m) => (
        <li
          key={m.id}
          className="py-2 flex items-center justify-between text-sm"
        >
          <span className="text-ink/70">
            {m.name ?? m.email}
            {showEmail ? (
              <span className="ml-2 text-xs text-ink/35">{m.email}</span>
            ) : null}
          </span>
          <span className="text-xs text-ink/40">{m.role}</span>
        </li>
      ))}
    </ul>
  );
}

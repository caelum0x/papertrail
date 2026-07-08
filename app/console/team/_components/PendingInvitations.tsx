import { RoleBadge } from "@/components/org-team/RoleBadge";
import type { Invitation } from "./types";

interface InvitationRowProps {
  invitation: Invitation;
  onRevoke: (id: string) => void;
}

// A single pending invitation row with a revoke action.
function InvitationRow({ invitation, onRevoke }: InvitationRowProps) {
  return (
    <li className="px-5 py-3 flex items-center justify-between">
      <div className="min-w-0">
        <div className="text-sm text-ink/80 truncate">{invitation.email}</div>
        <div className="text-xs text-ink/40">
          Invited{" "}
          {invitation.inviterName ? `by ${invitation.inviterName} ` : ""}·{" "}
          {new Date(invitation.createdAt).toLocaleDateString()}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <RoleBadge role={invitation.role} />
        <button
          onClick={() => onRevoke(invitation.id)}
          className="text-xs text-red-600 hover:underline"
        >
          Revoke
        </button>
      </div>
    </li>
  );
}

interface PendingInvitationsProps {
  invitations: Invitation[];
  loading: boolean;
  onRevoke: (id: string) => void;
}

// Card listing pending invitations, with loading/empty states.
export function PendingInvitations({
  invitations,
  loading,
  onRevoke,
}: PendingInvitationsProps) {
  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70">
        Pending invitations
      </div>
      {loading ? (
        <div className="p-5 text-sm text-ink/40">Loading...</div>
      ) : invitations.length === 0 ? (
        <div className="p-5 text-sm text-ink/40">No pending invitations.</div>
      ) : (
        <ul className="divide-y divide-ink/10">
          {invitations.map((inv) => (
            <InvitationRow key={inv.id} invitation={inv} onRevoke={onRevoke} />
          ))}
        </ul>
      )}
    </div>
  );
}

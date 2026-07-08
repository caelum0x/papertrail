"use client";

import type { PersonalToken } from "@/lib/account/types";
import { Button } from "@/components/account/fields";

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

interface TokenRowProps {
  token: PersonalToken;
  revoking: boolean;
  onRevoke: (id: string) => void;
}

// One personal access token row: name, when it was created, and when it was last
// used (so stale tokens are easy to spot), plus a revoke action.
export function TokenRow({ token, revoking, onRevoke }: TokenRowProps) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink/80">{token.name}</p>
        <p className="truncate text-xs text-ink/40">
          Created {formatDate(token.createdAt)} · Last used{" "}
          {formatDate(token.lastUsedAt)}
        </p>
      </div>
      <Button
        variant="danger"
        disabled={revoking}
        onClick={() => onRevoke(token.id)}
      >
        {revoking ? "Revoking…" : "Revoke"}
      </Button>
    </li>
  );
}

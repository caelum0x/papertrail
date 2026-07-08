"use client";

import type { SsoConnection } from "@/lib/sso/types";
import { StatusBadge, VerifiedBadge } from "@/components/sso/StatusBadge";
import { PROTOCOL_LABELS } from "@/components/sso/fields";

// Header for the connection detail view: name, protocol, status badges, and the
// primary lifecycle actions (activate / disable, delete). Action handlers are
// owned by the parent detail container.

interface DetailHeaderProps {
  connection: SsoConnection;
  busy: boolean;
  onToggleStatus: () => void;
  onDelete: () => void;
}

export function DetailHeader({
  connection,
  busy,
  onToggleStatus,
  onDelete,
}: DetailHeaderProps) {
  const isActive = connection.status === "active";
  const canActivate = connection.verified || isActive;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink/80 truncate">
            {connection.name}
          </h1>
          <span className="text-xs text-ink/40">
            {PROTOCOL_LABELS[connection.protocol] ?? connection.protocol}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <VerifiedBadge verified={connection.verified} />
          <StatusBadge status={connection.status} />
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onToggleStatus}
          disabled={busy || (!isActive && !canActivate)}
          title={
            !isActive && !canActivate
              ? "Verify the domain before activating."
              : undefined
          }
          className="text-sm border border-ink/15 rounded px-3 py-1.5 hover:border-accent disabled:opacity-40"
        >
          {isActive ? "Disable" : "Activate"}
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          className="text-sm text-red-600 hover:underline disabled:opacity-40"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

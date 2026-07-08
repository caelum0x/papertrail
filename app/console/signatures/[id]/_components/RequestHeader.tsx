"use client";

import type { SignatureRequest } from "@/lib/signatures/types";
import {
  RequestStatusBadge,
  EntityChip,
  formatDateTime,
} from "@/components/signatures/ui";

interface RequestHeaderProps {
  request: SignatureRequest;
  canCancel: boolean;
  cancelling: boolean;
  onCancel: () => void;
}

// Detail header: title, status, entity, created time, and (when permitted and
// the request is still open) a cancel action.
export function RequestHeader({
  request,
  canCancel,
  cancelling,
  onCancel,
}: RequestHeaderProps) {
  const isOpen = request.status === "draft" || request.status === "pending";
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">{request.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink/60">
            <RequestStatusBadge status={request.status} />
            <EntityChip
              entityType={request.entityType}
              entityId={request.entityId}
            />
            <span className="text-xs text-ink/40">
              Created {formatDateTime(request.createdAt)}
            </span>
          </div>
        </div>
        {canCancel && isOpen ? (
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="shrink-0 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            {cancelling ? "Cancelling…" : "Cancel request"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { RESOURCE_LABELS, type SavedViewDto } from "./api";

interface ViewHeaderProps {
  view: SavedViewDto;
  togglingShare: boolean;
  deleting: boolean;
  onToggleShare: () => void;
  onDelete: () => void;
}

// Detail header: view name + resource + ownership/sharing status on the left,
// owner-only actions (toggle sharing, delete) on the right. Non-owners see a
// read-only badge instead of actions.
export function ViewHeader({
  view,
  togglingShare,
  deleting,
  onToggleShare,
  onDelete,
}: ViewHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-ink/80">{view.name}</h1>
          {view.shared ? (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
              Shared
            </span>
          ) : (
            <span className="rounded-full bg-paper border border-ink/10 px-2 py-0.5 text-xs text-ink/50">
              Private
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-ink/40">
          {RESOURCE_LABELS[view.resource]} view
          {view.isOwner
            ? " · owned by you"
            : ` · by ${view.ownerName ?? "another member"}`}
        </p>
      </div>

      {view.isOwner ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleShare}
            disabled={togglingShare}
            className="rounded border border-ink/15 px-3 py-2 text-sm text-ink/70 hover:border-accent disabled:opacity-50"
          >
            {togglingShare
              ? "Saving..."
              : view.shared
              ? "Make private"
              : "Share with org"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="rounded border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      ) : (
        <span className="text-xs text-ink/40">Read-only</span>
      )}
    </div>
  );
}

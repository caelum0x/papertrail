"use client";

import Link from "next/link";
import { RESOURCE_LABELS, type SavedViewDto } from "./api";
import { QuerySummary } from "./QuerySummary";

interface ViewRowProps {
  view: SavedViewDto;
  deletingId: string | null;
  onDelete: (view: SavedViewDto) => void;
}

// One row in the ViewsList table: name (links to detail), resource, ownership +
// sharing badges, a compact query summary, and an owner-only delete action.
export function ViewRow({ view, deletingId, onDelete }: ViewRowProps) {
  const isDeleting = deletingId === view.id;
  return (
    <tr className="border-t border-ink/10 align-top">
      <td className="px-4 py-3">
        <Link
          href={`/console/views/${view.id}`}
          className="text-sm font-medium text-ink/80 hover:text-accent"
        >
          {view.name}
        </Link>
        <div className="mt-1">
          <QuerySummary query={view.query} />
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-ink/60">
        {RESOURCE_LABELS[view.resource]}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {view.shared ? (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent">
              Shared
            </span>
          ) : (
            <span className="rounded-full bg-paper border border-ink/10 px-2 py-0.5 text-xs text-ink/50">
              Private
            </span>
          )}
          {!view.isOwner ? (
            <span className="text-xs text-ink/40">
              by {view.ownerName ?? "another member"}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        {view.isOwner ? (
          <button
            type="button"
            onClick={() => onDelete(view)}
            disabled={isDeleting}
            className="text-sm text-red-600 hover:underline disabled:opacity-40"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        ) : (
          <span className="text-xs text-ink/30">—</span>
        )}
      </td>
    </tr>
  );
}

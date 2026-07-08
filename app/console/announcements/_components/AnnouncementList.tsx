"use client";

// Renders the announcement list body: loading, error, empty, and populated
// states. Delegates each item to AnnouncementRow. Admin action handlers are
// forwarded down from the page.
import { AnnouncementRow } from "@/components/announcements/AnnouncementRow";
import { EmptyState } from "@/components/announcements/EmptyState";
import type { AnnouncementDto } from "../api";

export function AnnouncementList({
  items,
  loading,
  error,
  isAdmin,
  onRetry,
  onPublish,
  onDelete,
  busyId,
}: {
  items: AnnouncementDto[];
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  onRetry: () => void;
  onPublish?: (id: string) => void;
  onDelete?: (id: string) => void;
  busyId: string | null;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-8 text-center text-sm text-ink/40">
        Loading announcements...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-white p-8 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <button
          onClick={onRetry}
          className="mt-3 rounded border border-ink/10 px-3 py-1.5 text-sm text-ink/70 hover:bg-ink/5"
        >
          Try again
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No announcements yet"
        message={
          isAdmin
            ? "Post your first announcement to keep the team informed."
            : "There's nothing new to read right now."
        }
      />
    );
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white px-4">
      {items.map((a) => (
        <AnnouncementRow
          key={a.id}
          announcement={a}
          isAdmin={isAdmin}
          onPublish={onPublish}
          onDelete={onDelete}
          busy={busyId === a.id}
        />
      ))}
    </div>
  );
}

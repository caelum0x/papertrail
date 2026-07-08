"use client";

// Vertical timeline of releases (the changelog). Handles loading, error, and
// empty states; renders each release as a dated node with its version and notes.
import { formatDate, type ReleaseDto } from "../api";
import { EmptyState } from "@/components/announcements/EmptyState";

export function ReleaseTimeline({
  releases,
  loading,
  error,
  onRetry,
}: {
  releases: ReleaseDto[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-8 text-center text-sm text-ink/40">
        Loading releases...
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

  if (releases.length === 0) {
    return (
      <EmptyState
        title="No releases yet"
        message="Published releases will appear here as a changelog."
      />
    );
  }

  return (
    <ol className="relative border-l border-ink/10 pl-6">
      {releases.map((r) => (
        <li key={r.id} className="relative pb-8 last:pb-0">
          <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-accent" />
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-ink/80">{r.version}</h3>
            <span className="text-xs text-ink/40">
              {formatDate(r.releasedAt)}
            </span>
          </div>
          {r.notes ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink/60">
              {r.notes}
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink/30">No notes.</p>
          )}
        </li>
      ))}
    </ol>
  );
}

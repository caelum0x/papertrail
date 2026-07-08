"use client";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

// Prev/Next pager shared by the token and session lists. Hidden when there is a
// single page so short lists don't show dead controls.
export function Pagination({
  page,
  totalPages,
  total,
  onPrev,
  onNext,
}: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-ink/10 px-5 py-3 text-xs text-ink/50">
      <span>
        Page {page} of {totalPages} · {total} total
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={page <= 1}
          className="rounded-md border border-ink/15 bg-white px-2.5 py-1 font-medium text-ink/70 hover:bg-ink/5 disabled:opacity-50"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages}
          className="rounded-md border border-ink/15 bg-white px-2.5 py-1 font-medium text-ink/70 hover:bg-ink/5 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

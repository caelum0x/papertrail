interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

// Prev/next pager with a "page X of Y · N total" caption. Buttons disable at the
// list bounds. Rendered only when there is more than one page of results.
export function Pagination({
  page,
  totalPages,
  total,
  onPrev,
  onNext,
}: PaginationProps) {
  return (
    <div className="mt-4 flex items-center justify-between">
      <p className="text-xs text-ink/40">
        Page {page} of {totalPages} · {total} total
      </p>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={page <= 1}
          className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={page >= totalPages}
          className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

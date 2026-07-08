interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

// Prev/next pager shown below the requests table when results exceed one page.
export function Pagination({
  page,
  totalPages,
  total,
  onPrev,
  onNext,
}: PaginationProps) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <span>
        Page {page} of {totalPages} · {total} total
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={page <= 1}
          className="rounded-md border border-ink/10 bg-white px-3 py-1.5 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={page >= totalPages}
          className="rounded-md border border-ink/10 bg-white px-3 py-1.5 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

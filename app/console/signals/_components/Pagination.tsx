interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

// Prev/next pager with a total signal count.
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
        {total} signal{total === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={onPrev}
          disabled={page <= 1}
          className="text-accent disabled:text-ink/30"
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          onClick={onNext}
          disabled={page >= totalPages}
          className="text-accent disabled:text-ink/30"
        >
          Next
        </button>
      </div>
    </div>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

// Prev / page-indicator / next pager used across the references module.
export function Pagination({ page, totalPages, onPrev, onNext }: PaginationProps) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <button onClick={onPrev} disabled={page <= 1} className="disabled:opacity-40">
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={page >= totalPages}
        className="disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

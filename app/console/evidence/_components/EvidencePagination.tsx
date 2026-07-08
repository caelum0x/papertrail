// Footer pager + total count for the evidence library.

interface EvidencePaginationProps {
  total: number;
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

export function EvidencePagination({
  total,
  page,
  totalPages,
  onPrev,
  onNext,
}: EvidencePaginationProps) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <span>
        {total} item{total === 1 ? "" : "s"}
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

// Footer pager for the documents library table.

interface DocumentsPaginationProps {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

export function DocumentsPagination({
  page,
  totalPages,
  onPrev,
  onNext,
}: DocumentsPaginationProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-t border-ink/15">
      <button
        onClick={onPrev}
        disabled={page <= 1}
        className="text-sm text-ink/60 disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-xs text-ink/40">
        Page {page} of {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={page >= totalPages}
        className="text-sm text-ink/60 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

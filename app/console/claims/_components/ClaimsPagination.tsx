// Footer pager + total count for the claims list.

interface ClaimsPaginationProps {
  total: number;
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

export function ClaimsPagination({
  total,
  page,
  totalPages,
  onPrev,
  onNext,
}: ClaimsPaginationProps) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <span>
        {total} claim{total === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={page <= 1}
          className="rounded border border-ink/15 px-3 py-1 disabled:opacity-40"
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          onClick={onNext}
          disabled={page >= totalPages}
          className="rounded border border-ink/15 px-3 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

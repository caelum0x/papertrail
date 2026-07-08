interface AuditPaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

// Pagination controls plus a page/total summary for the audit log.
export function AuditPagination({
  page,
  totalPages,
  total,
  onPrev,
  onNext,
}: AuditPaginationProps) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <span>
        Page {page} of {totalPages} · {total.toLocaleString()} events
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={page <= 1}
          className="px-3 py-1 border border-ink/15 rounded disabled:opacity-40"
        >
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={page >= totalPages}
          className="px-3 py-1 border border-ink/15 rounded disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// Simple prev/next pager shared across the module's list views.
export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="rounded border border-ink/10 px-3 py-1 disabled:opacity-40 hover:bg-paper"
      >
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="rounded border border-ink/10 px-3 py-1 disabled:opacity-40 hover:bg-paper"
      >
        Next
      </button>
    </div>
  );
}

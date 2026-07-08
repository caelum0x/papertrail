// Inline per-row error message for a failed import row.
export function RowError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <span className="text-xs text-red-700" title={error}>
      {error}
    </span>
  );
}

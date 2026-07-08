// Generic empty-state block used across the SSO module lists. Presentational.

interface EmptyStateProps {
  title: string;
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="bg-white border border-dashed border-ink/15 rounded-lg p-8 text-center">
      <p className="text-sm font-medium text-ink/70">{title}</p>
      <p className="mt-1 text-sm text-ink/50">{message}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

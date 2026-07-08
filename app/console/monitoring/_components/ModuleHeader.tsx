interface ModuleHeaderProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

// Page header for the monitoring list: title, blurb, and a single primary action.
export function ModuleHeader({
  title,
  description,
  actionLabel,
  onAction,
}: ModuleHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">{title}</h1>
        <p className="mt-1 text-sm text-ink/40">{description}</p>
      </div>
      <button
        onClick={onAction}
        className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
      >
        {actionLabel}
      </button>
    </div>
  );
}

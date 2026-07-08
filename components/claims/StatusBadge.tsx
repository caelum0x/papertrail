// Presentational status badge for a claim's lifecycle state. Pure: maps a status
// string to Tailwind classes and a human label. Unknown statuses render neutrally.

interface StatusBadgeProps {
  status: string;
}

const STATUS_STYLES: Record<string, { label: string; classes: string }> = {
  draft: { label: "Draft", classes: "bg-ink/5 text-ink/60 border-ink/15" },
  submitted: {
    label: "Submitted",
    classes: "bg-blue-50 text-blue-700 border-blue-200",
  },
  verifying: {
    label: "Verifying",
    classes: "bg-yellow-50 text-yellow-800 border-yellow-200",
  },
  verified: {
    label: "Verified",
    classes: "bg-green-50 text-green-700 border-green-200",
  },
  flagged: {
    label: "Flagged",
    classes: "bg-red-50 text-red-700 border-red-200",
  },
  archived: {
    label: "Archived",
    classes: "bg-ink/5 text-ink/40 border-ink/10",
  },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? {
    label: status,
    classes: "bg-ink/5 text-ink/60 border-ink/15",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${style.classes}`}
    >
      {style.label}
    </span>
  );
}

export type Severity = "low" | "medium" | "high" | "critical";

// Fixed severity -> Tailwind class map so a finding's band is instantly legible
// and never built from raw input. Colors escalate low -> critical.
const SEVERITY_CLASS: Record<Severity, string> = {
  low: "bg-ink/5 text-ink/60 border-ink/10",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

interface SeverityBadgeProps {
  severity: Severity;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${SEVERITY_CLASS[severity]}`}
    >
      {severity}
    </span>
  );
}

import type { Severity } from "./SeverityBadge";

// The filter can be "all" (no severity constraint) or a specific band.
export type SeverityFilterValue = "all" | Severity;

const OPTIONS: { value: SeverityFilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

interface SeverityFilterProps {
  value: SeverityFilterValue;
  counts: Record<Severity, number>;
  total: number;
  onChange: (value: SeverityFilterValue) => void;
}

// Segmented severity filter. Each option shows its running count so an operator
// sees the distribution before drilling in.
export function SeverityFilter({
  value,
  counts,
  total,
  onChange,
}: SeverityFilterProps) {
  function countFor(option: SeverityFilterValue): number {
    return option === "all" ? total : counts[option];
  }

  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-ink/10 bg-white p-1">
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-ink/90 text-white"
                : "text-ink/60 hover:bg-ink/5"
            }`}
          >
            {opt.label}
            <span
              className={`ml-1.5 tabular-nums ${
                active ? "text-white/70" : "text-ink/30"
              }`}
            >
              {countFor(opt.value)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

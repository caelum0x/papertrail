import { RANGE_OPTIONS } from "./shared";

interface RangePickerProps {
  days: number;
  onChange: (days: number) => void;
  disabled?: boolean;
}

// Segmented control for the lookback window. Used by the summary and timeseries
// pages. Pure/controlled — the parent owns the selected value.
export function RangePicker({ days, onChange, disabled }: RangePickerProps) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-ink/15 bg-white">
      {RANGE_OPTIONS.map((opt, i) => {
        const active = opt.days === days;
        return (
          <button
            key={opt.days}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.days)}
            className={[
              "px-3 py-1.5 text-sm disabled:opacity-40",
              i > 0 ? "border-l border-ink/15" : "",
              active ? "bg-accent/10 font-medium text-accent" : "text-ink/60 hover:bg-paper",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

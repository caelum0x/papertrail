"use client";

interface RangeOption {
  label: string;
  days: number;
}

interface RangeSelectProps {
  options: RangeOption[];
  value: number;
  onChange: (days: number) => void;
}

// Labeled range dropdown for the verification-trends sub-page.
export function RangeSelect({ options, value, onChange }: RangeSelectProps) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink/60">
      Range
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-ink/10 bg-white px-2 py-1.5 text-sm text-ink/80 focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.days} value={o.days}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

"use client";

interface FilterOption<T extends string> {
  value: T;
  label: string;
}

interface FilterChipsProps<T extends string> {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  keyPrefix: string;
}

// Row of pill-style filter buttons; the active option is accent-outlined.
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  keyPrefix,
}: FilterChipsProps<T>) {
  return (
    <div className="flex items-center gap-1.5">
      {options.map((f) => (
        <button
          key={f.value || keyPrefix}
          onClick={() => onChange(f.value)}
          className={`text-xs px-2.5 py-1 rounded-full border ${
            value === f.value
              ? "border-accent text-accent font-medium"
              : "border-ink/10 text-ink/60 hover:border-ink/20"
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

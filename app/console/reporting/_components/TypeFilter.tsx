import { REPORT_TYPES } from "@/lib/reporting/types";
import { typeLabel } from "./format";

interface TypeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

// Filter bar for the report list: narrows definitions by report type.
export function TypeFilter({ value, onChange }: TypeFilterProps) {
  return (
    <div className="mt-4 flex items-center gap-2 text-sm">
      <label htmlFor="report-type" className="text-ink/50">
        Type
      </label>
      <select
        id="report-type"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-ink/70"
      >
        <option value="">All types</option>
        {REPORT_TYPES.map((t) => (
          <option key={t} value={t}>
            {typeLabel(t)}
          </option>
        ))}
      </select>
    </div>
  );
}

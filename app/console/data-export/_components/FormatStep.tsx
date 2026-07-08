import { EXPORT_FORMATS, type ExportFormat } from "@/lib/dataexport/schemas";
import { FORMAT_LABELS } from "./shared";

interface FormatStepProps {
  value: ExportFormat;
  onChange: (format: ExportFormat) => void;
}

const FORMAT_HINTS: Record<ExportFormat, string> = {
  csv: "Tabular, opens in spreadsheets. One row per record.",
  json: "Structured array of objects. Best for programmatic use.",
};

// Wizard step 2: pick the output format (CSV or JSON).
export function FormatStep({ value, onChange }: FormatStepProps) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink/80">
        Choose a format
      </legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {EXPORT_FORMATS.map((format) => {
          const selected = format === value;
          return (
            <button
              key={format}
              type="button"
              onClick={() => onChange(format)}
              className={`rounded-lg border p-3 text-left transition ${
                selected
                  ? "border-accent bg-accent/5"
                  : "border-ink/15 bg-white hover:bg-paper"
              }`}
            >
              <span className="block text-sm font-medium text-ink/80">
                {FORMAT_LABELS[format]}
              </span>
              <span className="mt-0.5 block text-xs text-ink/50">
                {FORMAT_HINTS[format]}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

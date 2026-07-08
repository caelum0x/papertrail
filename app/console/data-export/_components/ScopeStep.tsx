import { EXPORT_SCOPES, type ExportScope } from "@/lib/dataexport/schemas";
import { SCOPE_DESCRIPTIONS, SCOPE_LABELS } from "./shared";

interface ScopeStepProps {
  value: ExportScope;
  onChange: (scope: ExportScope) => void;
}

// Wizard step 1: pick which data domain to export. Renders a selectable card per
// scope with a short description.
export function ScopeStep({ value, onChange }: ScopeStepProps) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-ink/80">
        What do you want to export?
      </legend>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {EXPORT_SCOPES.map((scope) => {
          const selected = scope === value;
          return (
            <button
              key={scope}
              type="button"
              onClick={() => onChange(scope)}
              className={`rounded-lg border p-3 text-left transition ${
                selected
                  ? "border-accent bg-accent/5"
                  : "border-ink/15 bg-white hover:bg-paper"
              }`}
            >
              <span className="block text-sm font-medium text-ink/80">
                {SCOPE_LABELS[scope]}
              </span>
              <span className="mt-0.5 block text-xs text-ink/50">
                {SCOPE_DESCRIPTIONS[scope]}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

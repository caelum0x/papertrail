import type { ExportFormat, ExportScope } from "@/lib/dataexport/schemas";
import { FORMAT_LABELS, SCOPE_DESCRIPTIONS, SCOPE_LABELS } from "./shared";

interface ConfirmStepProps {
  scope: ExportScope;
  format: ExportFormat;
}

// Wizard step 3: review the chosen scope + format before starting the export.
export function ConfirmStep({ scope, format }: ConfirmStepProps) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-ink/80">Review &amp; confirm</h2>
      <dl className="mt-3 divide-y divide-ink/10 rounded-lg border border-ink/15 bg-white text-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="text-ink/50">Scope</dt>
          <dd className="font-medium text-ink/80">{SCOPE_LABELS[scope]}</dd>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="text-ink/50">Format</dt>
          <dd className="font-medium text-ink/80">{FORMAT_LABELS[format]}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink/40">
        {SCOPE_DESCRIPTIONS[scope]} The export runs immediately and is scoped to
        your current organization.
      </p>
    </div>
  );
}

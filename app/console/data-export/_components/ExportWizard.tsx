"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExportFormat, ExportScope } from "@/lib/dataexport/schemas";
import { startExport } from "./api";
import { ScopeStep } from "./ScopeStep";
import { FormatStep } from "./FormatStep";
import { ConfirmStep } from "./ConfirmStep";

interface ExportWizardProps {
  canEdit: boolean;
}

const STEPS = ["Scope", "Format", "Confirm"] as const;

// Three-step guided export builder (ScopeStep -> FormatStep -> ConfirmStep). On
// confirm it POSTs to /api/data-exports and routes to the new export's detail
// page so the user can download it.
export function ExportWizard({ canEdit }: ExportWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [scope, setScope] = useState<ExportScope>("claims");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-8 text-center">
        <p className="text-sm text-ink/60">
          You need editor access to start an export.
        </p>
      </div>
    );
  }

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    const result = await startExport({ scope, format });
    setSubmitting(false);
    if (result.error || !result.data) {
      setError(result.error ?? "Couldn't start the export.");
      return;
    }
    router.push(`/console/data-export/${result.data.id}`);
  };

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-6">
      {/* Step indicator */}
      <ol className="mb-6 flex items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                i <= step
                  ? "bg-accent text-white"
                  : "bg-ink/10 text-ink/40"
              }`}
            >
              {i + 1}
            </span>
            <span className={i === step ? "text-ink/80" : "text-ink/40"}>
              {label}
            </span>
            {i < STEPS.length - 1 ? (
              <span className="mx-1 h-px w-6 bg-ink/15" />
            ) : null}
          </li>
        ))}
      </ol>

      {step === 0 ? <ScopeStep value={scope} onChange={setScope} /> : null}
      {step === 1 ? <FormatStep value={format} onChange={setFormat} /> : null}
      {step === 2 ? <ConfirmStep scope={scope} format={format} /> : null}

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || submitting}
          className="rounded-md border border-ink/15 bg-white px-4 py-2 text-sm text-ink/60 hover:bg-paper disabled:opacity-40"
        >
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "Starting…" : "Start export"}
          </button>
        )}
      </div>
    </div>
  );
}

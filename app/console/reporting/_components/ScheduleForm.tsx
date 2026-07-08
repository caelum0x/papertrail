"use client";

import { useState } from "react";
import type { ReportDefinition } from "@/lib/reporting/types";

interface ScheduleFormProps {
  definitions: ReportDefinition[];
  submitting: boolean;
  onSubmit: (input: {
    definitionId: string;
    cron: string;
    recipients: string[];
    enabled: boolean;
  }) => void;
}

// Form to schedule a report: pick a definition, set a cron expression and a
// comma-separated recipient list. Validates locally before delegating; the API
// re-validates with zod.
export function ScheduleForm({
  definitions,
  submitting,
  onSubmit,
}: ScheduleFormProps) {
  const [definitionId, setDefinitionId] = useState("");
  const [cron, setCron] = useState("0 9 * * 1");
  const [recipients, setRecipients] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = () => {
    setLocalError(null);
    if (!definitionId) {
      setLocalError("Choose a report to schedule.");
      return;
    }
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5 && parts.length !== 6) {
      setLocalError("Cron must have 5 or 6 fields.");
      return;
    }
    const list = recipients
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    onSubmit({ definitionId, cron: cron.trim(), recipients: list, enabled });
  };

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/80">Schedule a report</h2>

      <div className="mt-3 space-y-3">
        <div>
          <label
            htmlFor="schedule-definition"
            className="block text-xs font-medium text-ink/50"
          >
            Report
          </label>
          <select
            id="schedule-definition"
            value={definitionId}
            onChange={(e) => setDefinitionId(e.target.value)}
            className="mt-1 w-full rounded border border-ink/15 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">Select a report…</option>
            {definitions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="schedule-cron"
            className="block text-xs font-medium text-ink/50"
          >
            Cron expression
          </label>
          <input
            id="schedule-cron"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 9 * * 1"
            className="mt-1 w-full rounded border border-ink/15 bg-white px-2 py-1.5 font-mono text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="schedule-recipients"
            className="block text-xs font-medium text-ink/50"
          >
            Recipients (comma-separated emails)
          </label>
          <input
            id="schedule-recipients"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="team@example.com, lead@example.com"
            className="mt-1 w-full rounded border border-ink/15 bg-white px-2 py-1.5 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink/70">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>

        {localError ? (
          <p className="text-sm text-red-700">{localError}</p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={submitting || definitions.length === 0}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Scheduling..." : "Create schedule"}
        </button>
        {definitions.length === 0 ? (
          <p className="text-xs text-ink/40">
            Create a report first, then schedule it.
          </p>
        ) : null}
      </div>
    </div>
  );
}

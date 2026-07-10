"use client";

// Save button for a computed Evidence Workbench report. POSTs the already-computed
// composite object (no recompute) to the org-scoped /api/evidence-reports route and
// shows a saved confirmation with a link to the saved-reports list. Handles the
// unauthenticated (401), no-access (403), and generic error states inline.

import { useCallback, useState } from "react";
import Link from "next/link";
import { apiSend, type SavedEvidenceReportDto } from "../../evidence-reports/api";
import type { EvidenceReport } from "./types";

interface SaveReportButtonProps {
  claim: string;
  // Only the ok:true report is savable — the caller must not render this for an
  // insufficient-evidence result.
  report: EvidenceReport;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; id: string }
  | { status: "error"; message: string };

export function SaveReportButton({ claim, report }: SaveReportButtonProps) {
  const [state, setState] = useState<SaveState>({ status: "idle" });

  const onSave = useCallback(async () => {
    setState({ status: "saving" });
    // Denormalized summary fields for list/scan; the full composite is stored as
    // `report`. These map to optional columns and are safe to omit.
    const payload = {
      claim,
      verdict: report.verdict.verdict,
      certainty: report.certainty.certainty,
      pooled: report.pooled as unknown as Record<string, unknown>,
      report: report as unknown as Record<string, unknown>,
    };
    const res = await apiSend<SavedEvidenceReportDto>(
      "/api/evidence-reports",
      "POST",
      payload
    );
    if (!res.success || !res.data) {
      setState({ status: "error", message: res.error ?? "Couldn't save the report." });
      return;
    }
    setState({ status: "saved", id: res.data.id });
  }, [claim, report]);

  if (state.status === "saved") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm">
        <span className="font-medium text-green-800">Report saved.</span>
        <Link
          href={`/console/evidence-reports/${state.id}`}
          className="text-accent hover:underline"
        >
          View saved report
        </Link>
        <Link href="/console/evidence-reports" className="text-accent hover:underline">
          All saved reports
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={state.status === "saving"}
        className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-50"
      >
        {state.status === "saving" ? "Saving…" : "Save report"}
      </button>
      {state.status === "error" ? (
        <span className="text-sm text-red-700" role="alert">
          {state.message}
        </span>
      ) : (
        <Link
          href="/console/evidence-reports"
          className="text-sm text-accent hover:underline"
        >
          Saved reports
        </Link>
      )}
    </div>
  );
}

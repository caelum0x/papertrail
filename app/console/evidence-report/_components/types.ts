// Client-side types for the evidence-report console. These mirror the server
// response shape from lib/evidenceReport.ts (imported directly as types so they
// stay in sync) plus the local form-row model used by the input grid.

import type {
  BuildEvidenceReportResult,
  EvidenceReport,
  InsufficientEvidenceReport,
} from "@/lib/evidenceReport";

export type { BuildEvidenceReportResult, EvidenceReport, InsufficientEvidenceReport };

export type Measure = "RR" | "HR" | "OR";

// One editable study row in the input grid. All numeric fields are strings while
// being typed, parsed to numbers only when the payload is built.
export interface StudyForm {
  id: string;
  label: string;
  measure: Measure;
  point: string;
  ciLower: string;
  ciUpper: string;
  ciPct: string;
}

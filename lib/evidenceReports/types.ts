// Shared types for persisted evidence reports. Framework-agnostic so both the
// API route handlers and client components can import them. DB rows are
// snake_case; these camelCase shapes are what the repository maps to and the API
// returns.
//
// A record stores the full composite object the evidence engine produced (see
// lib/evidenceReport.ts) alongside a few denormalized columns (claim, verdict,
// certainty, pooled) so lists and scans never need to crack open the jsonb.

// The full composite report is an opaque object at this layer: the engine owns
// its shape (lib/evidenceReport.ts), and this persistence layer never recomputes
// or reinterprets it — it stores and returns exactly what the caller submitted.
export type EvidenceReportPayload = Record<string, unknown>;

export interface EvidenceReportRecord {
  id: string;
  orgId: string;
  projectId: string | null;
  createdBy: string | null;
  claim: string;
  verdict: string | null;
  certainty: string | null;
  pooled: EvidenceReportPayload | null;
  report: EvidenceReportPayload;
  createdAt: string;
}

// Fields a caller supplies to persist a report. org_id, id, and created_at are
// assigned by the repository/DB — never by the client.
export interface CreateEvidenceReportInput {
  orgId: string;
  projectId?: string | null;
  createdBy?: string | null;
  claim: string;
  verdict?: string | null;
  certainty?: string | null;
  pooled?: EvidenceReportPayload | null;
  report: EvidenceReportPayload;
}

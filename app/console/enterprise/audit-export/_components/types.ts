// Client-side view types for the enterprise audit-export console. These mirror
// the server shapes in lib/enterprise/auditExport.ts but are declared here so the
// client bundle never imports server-only modules (pg pool, etc.).

export interface ChainVerificationView {
  ok: boolean;
  length: number;
  brokenAtSeq: number | null;
  reason: string | null;
}

export interface AuditExportEntryView {
  id: string;
  seq: number;
  prev_hash: string;
  entry_hash: string;
  recomputed_hash: string;
  hash_matches: boolean;
  event: Record<string, unknown>;
  created_at: string;
}

export interface AuditExportGapView {
  seq: number;
  kind: "non_contiguous_seq" | "broken_linkage" | "tampered_event";
  detail: string;
}

export interface AuditExportCoverageView {
  exported_entries: number;
  total_chain_entries: number;
  windowed: boolean;
  entries_before_window: number;
  entries_after_window: number;
  first_seq: number | null;
  last_seq: number | null;
  first_at: string | null;
  last_at: string | null;
  window: { from: string | null; to: string | null };
}

export interface AuditExportView {
  format_version: 1;
  org_id: string;
  chain_verification: ChainVerificationView;
  coverage: AuditExportCoverageView;
  entries: AuditExportEntryView[];
  gaps: AuditExportGapView[];
  export_hash: string;
  generated_at: string;
}

// The upgrade envelope returned with a 402 when the org's tier does not entitle
// audit_export. Drives the upgrade CTA.
export interface UpgradeDetail {
  feature: string;
  currentTier: string;
  requiredTiers: string[];
}

// Discriminated result of an assemble attempt: the export, an upgrade wall, or a
// plain error message.
export type AssembleResult =
  | { kind: "ok"; data: AuditExportView }
  | { kind: "upgrade"; detail: UpgradeDetail; message: string }
  | { kind: "error"; message: string };

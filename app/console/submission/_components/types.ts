// Client-side types for the submission-bundle console. These mirror the manifest
// contract in lib/submission/schemas.ts but are declared here so the "use client"
// components never import server-only modules (pg / crypto). Keep in sync with the
// server schemas; both are the shape the /api/submission/bundle route returns.

export type BundleSectionKind =
  | "summary_of_findings"
  | "methods"
  | "evidence_table"
  | "provenance_appendix";

export interface FindingRow {
  kind: "verification" | "evidence_report";
  ref_id: string;
  claim: string;
  discrepancy_type: string | null;
  trust_score: number | null;
  verdict: string | null;
  certainty: string | null;
  grounded_spans: number;
}

export interface MethodEntry {
  engine: string;
  description: string;
}

export interface Downgrade {
  domain: string;
  steps: number;
  reason: string;
}

export interface PooledEstimate {
  measure: string;
  point: number;
  ci_lower: number;
  ci_upper: number;
  ci_pct: number;
  studies: number;
  i_squared: number;
  significant: boolean;
  certainty: string;
  downgrades: Downgrade[];
}

export interface CustodyRecord {
  verification_id: string;
  source_id: string;
  doi: string | null;
  pmid: string | null;
  source_version: string | null;
  snapshot_date: string | null;
  content_hash: string | null;
  source_span: string;
  span_start: number;
  span_end: number;
  chain_of_custody_hash: string;
}

export interface CustodySummary {
  verification_id: string;
  source_id: string | null;
  source_version: string | null;
  snapshot_date: string | null;
  content_hash: string | null;
  doi: string | null;
  pmid: string | null;
  records: CustodyRecord[];
  dropped_ungroundable: number;
  aggregate_hash: string;
}

export interface BundleGap {
  kind: string;
  ref_id: string | null;
  detail: string;
}

export interface BundleManifest {
  org_id: string;
  generated_at: string;
  bundle_hash: string;
  summary_of_findings: FindingRow[];
  methods: MethodEntry[];
  evidence_table: PooledEstimate[];
  provenance_appendix: CustodySummary[];
  gaps: BundleGap[];
  counts: {
    verifications_requested: number;
    verifications_included: number;
    evidence_reports_included: number;
    grounded_spans: number;
    dropped_ungroundable_spans: number;
    gaps: number;
  };
}

// A row of the org's evidence-report list, as returned by /api/evidence-reports.
export interface EvidenceReportListItem {
  id: string;
  claim: string;
  verdict: string | null;
  certainty: string | null;
  createdAt: string;
}

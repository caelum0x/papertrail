// Client-side mirror of the server ChainOfCustody shape returned by
// GET /api/audit-chain/verification/[id]. Kept in sync with
// lib/provenance/chainOfCustody.ts.

export interface CustodyRecordView {
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

export interface ChainOfCustodyView {
  verification_id: string;
  source_id: string | null;
  source_version: string | null;
  snapshot_date: string | null;
  content_hash: string | null;
  doi: string | null;
  pmid: string | null;
  records: CustodyRecordView[];
  dropped_ungroundable: number;
  aggregate_hash: string;
}

// Per-record local verification state for the "verify hash" button.
export type VerifyState = "unchecked" | "match" | "mismatch";

// Shared types for the Compliance module (e-signatures, WORM audit chain,
// retention policies). Kept dependency-free so both server repositories and
// client components can import the shapes.

export const SIGNATURE_MEANINGS = [
  "approval",
  "review",
  "authorship",
  "responsibility",
] as const;

export type SignatureMeaning = (typeof SIGNATURE_MEANINGS)[number];

export interface Signature {
  id: string;
  org_id: string;
  entity_type: string;
  entity_id: string;
  signer_id: string;
  signer_name: string | null;
  signer_email: string | null;
  meaning: SignatureMeaning;
  signed_hash: string;
  signed_at: string;
  created_at: string;
}

// A single entry in the org's append-only hash chain. The `event` payload is
// opaque JSON describing what happened; integrity comes from the hash linkage.
export interface AuditChainEntry {
  id: string;
  org_id: string;
  seq: number;
  prev_hash: string;
  entry_hash: string;
  event: Record<string, unknown>;
  created_at: string;
}

export interface RetentionPolicy {
  id: string;
  org_id: string;
  entity_type: string;
  retain_days: number;
  created_at: string;
}

// Result of verifying a chain end-to-end. When ok is false, `brokenAtSeq`
// points at the first entry whose recomputed hash or linkage did not match.
export interface ChainVerification {
  ok: boolean;
  length: number;
  brokenAtSeq: number | null;
  reason: string | null;
}

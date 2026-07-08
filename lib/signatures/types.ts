// Shared types for the e-signature request workflow. Framework-agnostic so both
// the API route handlers and the client components can import them. DB rows are
// snake_case; these camelCase shapes are what the API returns.

// Lifecycle of a signature request:
//   draft     — created, signers may still be added
//   pending   — at least one signer, awaiting signatures in order
//   completed — every signer has signed; a certificate has been issued
//   cancelled — abandoned before completion; no certificate
export const REQUEST_STATUSES = [
  "draft",
  "pending",
  "completed",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// Per-signer state within a request. A signer is 'pending' until they sign, at
// which point they become 'signed'. A cancelled request leaves un-signed signers
// as 'pending' (the request status is the source of truth for cancellation).
export const SIGNER_STATUSES = ["pending", "signed"] as const;
export type SignerStatus = (typeof SIGNER_STATUSES)[number];

// The kind of entity a request signs over. Kept as free text at the DB layer so
// new entity types can be signed without a migration; these are the built-ins.
export const ENTITY_TYPES = [
  "claim",
  "report",
  "verification",
  "document",
  "project",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number] | string;

export interface SignatureRequest {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  title: string;
  status: RequestStatus;
  createdBy: string | null;
  createdAt: string;
}

export interface SignatureSigner {
  id: string;
  orgId: string;
  requestId: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  orderIndex: number;
  status: SignerStatus;
  signedAt: string | null;
  createdAt: string;
}

export interface SignatureCertificate {
  id: string;
  orgId: string;
  requestId: string;
  certHash: string;
  issuedAt: string;
  createdAt: string;
}

// A request plus its ordered signer trail and (once completed) certificate.
// Returned by the detail endpoint so the console can render the full ceremony.
export interface SignatureRequestDetail {
  request: SignatureRequest;
  signers: SignatureSigner[];
  certificate: SignatureCertificate | null;
}

// The signer whose turn it is (lowest order_index still pending), or null when
// the request has no outstanding signers.
export function currentSigner(
  signers: readonly SignatureSigner[]
): SignatureSigner | null {
  const pending = signers
    .filter((s) => s.status === "pending")
    .sort((a, b) => a.orderIndex - b.orderIndex);
  return pending[0] ?? null;
}

export function allSigned(signers: readonly SignatureSigner[]): boolean {
  return signers.length > 0 && signers.every((s) => s.status === "signed");
}

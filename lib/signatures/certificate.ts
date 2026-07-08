import { createHash } from "node:crypto";
import type { SignatureRequest, SignatureSigner } from "@/lib/signatures/types";

// Tamper-evident certificate digest for a completed signature request. Mirrors
// the compliance module's evidence pattern: a deterministic SHA-256 over a
// canonical, ordered projection of the request and its signer trail. Any change
// to who signed, in what order, or when, changes the hash.

interface CertificateInput {
  request: Pick<
    SignatureRequest,
    "id" | "orgId" | "entityType" | "entityId" | "title"
  >;
  signers: readonly Pick<
    SignatureSigner,
    "userId" | "orderIndex" | "signedAt"
  >[];
}

// Produces the canonical string that gets hashed. Signers are sorted by
// order_index so serialization is stable regardless of input ordering.
export function canonicalPayload(input: CertificateInput): string {
  const signers = [...input.signers]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((s) => `${s.orderIndex}:${s.userId}:${s.signedAt ?? ""}`);
  return [
    `request:${input.request.id}`,
    `org:${input.request.orgId}`,
    `entity:${input.request.entityType}/${input.request.entityId}`,
    `title:${input.request.title}`,
    `signers:${signers.join("|")}`,
  ].join("\n");
}

export function computeCertHash(input: CertificateInput): string {
  return createHash("sha256").update(canonicalPayload(input), "utf8").digest("hex");
}

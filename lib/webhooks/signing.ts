import { randomBytes, createHmac } from "crypto";

// Webhook signing. Each webhook has a high-entropy secret. Every delivery is
// signed with an HMAC-SHA256 over the exact request body so the receiver can
// verify the payload came from PaperTrail and wasn't tampered with. The secret
// is shown to the org once at creation and stored so we can re-sign deliveries.

const SECRET_BYTES = 24; // 192 bits of entropy
const PREFIX = "whsec_";
const SIGNATURE_HEADER = "X-PaperTrail-Signature";

// Generates a new signing secret, e.g. "whsec_ab12...".
export function generateWebhookSecret(): string {
  return `${PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;
}

// A short, non-secret hint for display in the portal (never the full secret).
export function secretHint(secret: string): string {
  return `${secret.slice(0, PREFIX.length + 4)}…`;
}

// Deterministic HMAC-SHA256 signature of the raw body, hex-encoded. The header
// is prefixed with the scheme so receivers can evolve the algorithm later.
export function signPayload(secret: string, body: string): string {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}

export const WEBHOOK_SIGNATURE_HEADER = SIGNATURE_HEADER;

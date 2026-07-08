import { randomBytes, createHash } from "crypto";

// API key crypto. Keys are high-entropy random tokens shown to the user exactly
// once. We store only a SHA-256 hash (deterministic, so a presented key can be
// looked up in O(1)) plus a short non-secret prefix for display. We never store
// or log the raw secret.

const KEY_BYTES = 24; // 192 bits of entropy
const PREFIX = "pt_live_";

export interface GeneratedKey {
  // The full secret to return to the caller once (e.g. "pt_live_ab12...").
  key: string;
  // Deterministic hash stored in api_keys.key_hash.
  keyHash: string;
  // Non-secret display hint stored in api_keys.key_prefix.
  keyPrefix: string;
}

// Deterministic hash used for storage & lookup. Not reversible.
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): GeneratedKey {
  const secret = randomBytes(KEY_BYTES).toString("base64url");
  const key = `${PREFIX}${secret}`;
  // First 6 chars of the secret give a recognizable, non-guessable hint.
  const keyPrefix = `${PREFIX}${secret.slice(0, 6)}`;
  return { key, keyHash: hashApiKey(key), keyPrefix };
}

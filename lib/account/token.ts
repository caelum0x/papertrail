import { createHash, randomBytes } from "crypto";

// Personal access token minting + hashing. The plaintext token is shown to the
// user exactly once (at creation) and never persisted — only its SHA-256 hash is
// stored, so a database leak can't be used to authenticate. Tokens carry a fixed
// visible prefix so they're recognizable in logs / UIs without revealing entropy.

const TOKEN_PREFIX = "pt_pat_";
const TOKEN_BYTES = 24; // 192 bits of entropy, hex-encoded.

// Generates a fresh plaintext token and its storage hash.
export function generateToken(): { plaintext: string; hash: string } {
  const secret = randomBytes(TOKEN_BYTES).toString("hex");
  const plaintext = `${TOKEN_PREFIX}${secret}`;
  return { plaintext, hash: hashToken(plaintext) };
}

// Deterministic hash used for storage and (future) lookup. SHA-256 is sufficient
// because the token itself is high-entropy random, so it isn't guessable and
// doesn't need a slow KDF the way a low-entropy human password does.
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

// A short, non-secret display hint (prefix only) for a token — never the secret.
export function tokenDisplayPrefix(): string {
  return TOKEN_PREFIX;
}

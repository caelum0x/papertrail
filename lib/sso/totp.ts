import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// Dependency-free RFC 6238 TOTP (Time-based One-Time Password) + RFC 4648 base32.
// Used for the MFA module: we generate a base32 shared secret, hand it to the
// user's authenticator app via an otpauth:// URI, and verify 6-digit codes on a
// 30-second step with a ±1 window to tolerate clock skew.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = "PaperTrail";

// Encode raw bytes as unpadded base32 (uppercase). Deterministic and reversible.
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

// Decode a base32 string (padding and casing tolerant) back to bytes.
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue; // skip invalid chars defensively
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// Generate a new base32 TOTP secret (160 bits of entropy — the RFC-recommended
// size for HMAC-SHA1).
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

// Compute the TOTP code for a given secret and time step counter.
function hotp(secretBytes: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Write the 64-bit counter big-endian. JS bitwise is 32-bit, so split.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac("sha1", secretBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, "0");
}

// Verify a user-supplied code against the secret, allowing a ±1 step window to
// tolerate clock drift. Constant-time comparison to avoid timing leaks.
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const normalized = code.replace(/\D/g, "");
  if (normalized.length !== DIGITS) return false;
  const secretBytes = base32Decode(secret);
  if (secretBytes.length === 0) return false;
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  for (let w = -1; w <= 1; w++) {
    const expected = hotp(secretBytes, counter + w);
    if (
      expected.length === normalized.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))
    ) {
      return true;
    }
  }
  return false;
}

// Build the otpauth:// provisioning URI an authenticator app scans as a QR code.
export function buildOtpauthUri(secret: string, accountLabel: string): string {
  const label = encodeURIComponent(`${ISSUER}:${accountLabel}`);
  const params = new URLSearchParams({
    secret,
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

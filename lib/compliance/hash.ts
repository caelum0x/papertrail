import { createHash } from "crypto";

// Deterministic hashing primitives for the audit chain. Both the chain and the
// e-signature module rely on a *canonical* JSON encoding so that the same logical
// event always produces the same hash regardless of key insertion order.

// Fixed seed for the first entry in every org's chain. Using a constant (rather
// than an empty string) makes the genesis linkage explicit and self-documenting.
export const GENESIS_PREV_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

// Canonical JSON: object keys sorted recursively so encoding is order-independent.
// Arrays preserve order (order is semantically meaningful for arrays).
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortValue(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// The chain rule: entry_hash = sha256(prev_hash + canonical(event)).
export function computeEntryHash(
  prevHash: string,
  event: Record<string, unknown>
): string {
  return sha256Hex(prevHash + canonicalize(event));
}

"use client";

// Client-side, browser-safe recomputation of a per-span chain-of-custody hash.
// This MUST byte-for-byte mirror the server's computeCustodyHash in
// lib/provenance/chainOfCustody.ts: sha256Hex(canonicalize(tuple)), where
// canonicalize() is order-independent JSON with recursively sorted object keys
// (see lib/compliance/hash.ts). We reimplement both here using Web Crypto so the
// "verify hash" button proves integrity entirely in the browser — no server round
// trip, no trust in a second endpoint.

// Canonical JSON: recursively sort object keys; preserve array order. Mirrors
// lib/compliance/hash.ts canonicalize(). Only the JSON-representable value types
// produced by the custody tuple appear here (string | number | null).
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

function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// The exact tuple hashed on the server, in the same field set. canonicalize()
// makes field order here irrelevant, but we keep it aligned for readability.
export interface CustodyHashTuple {
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
}

export async function recomputeCustodyHash(
  tuple: CustodyHashTuple
): Promise<string> {
  return sha256Hex(canonicalize(tuple));
}

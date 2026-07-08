// Splits a pasted passage (e.g. a manuscript Discussion or an RPPR paragraph) into
// individual candidate claims for batch verification. Scientific prose is full of
// periods that do NOT end sentences — decimals (0.45), p-values (p<0.001),
// abbreviations (e.g., i.e., et al., vs.) — so a naive split on "." shreds the text.
// This tokenizer protects those cases, then splits on real sentence boundaries.
// Pure: no mutation of inputs, deterministic output.

// Sentinel standing in for a protected (non-sentence-ending) period during splitting.
// A private-use Unicode code point, effectively never present in pasted biomedical text.
const DOT = String.fromCharCode(0xe000);

// Abbreviations common in biomedical writing whose trailing period is NOT a sentence end.
const ABBREVIATIONS = [
  "e.g", "i.e", "cf", "vs", "etc", "al", "Dr", "Prof", "Mr", "Mrs", "Ms",
  "Fig", "Figs", "Eq", "Ref", "Refs", "No", "Nos", "approx", "ca", "Inc", "Ltd",
  "Co", "St", "Jr", "Sr", "Vol", "pp", "ed", "eds", "min", "max", "sec",
];

// A claim shorter than this (after trimming) is almost certainly a fragment, header,
// or citation stub rather than a verifiable statement — drop it.
const MIN_CLAIM_LENGTH = 15;

/**
 * Split `text` into candidate claim strings. Sentence boundaries are detected after
 * ., !, or ? followed by whitespace and a capital letter or digit — but only once
 * decimals and known abbreviations have been masked so they don't trigger a split.
 */
export function splitIntoClaims(text: string): string[] {
  if (!text || text.trim().length === 0) return [];

  const masked = maskProtectedPeriods(text);

  // Split on sentence-ending punctuation followed by space(s) and a capital/digit/quote.
  const rawParts = masked.split(/(?<=[.!?])\s+(?=["'“]?[A-Z0-9])/);

  const claims: string[] = [];
  for (const part of rawParts) {
    const restored = unmask(part).trim();
    if (isLikelyClaim(restored)) {
      claims.push(restored);
    }
  }
  return claims;
}

function maskProtectedPeriods(text: string): string {
  let out = text;

  // Decimals and version-like numbers: 0.45, 1.66, p<0.001 → protect the inner dot.
  out = out.replace(/(\d)\.(\d)/g, `$1${DOT}$2`);

  // Known abbreviations followed by a period (case-insensitive on the token).
  for (const abbr of ABBREVIATIONS) {
    const re = new RegExp(`\\b(${escapeRegExp(abbr)})\\.`, "gi");
    out = out.replace(re, `$1${DOT}`);
  }

  // Single-capital-letter initials (e.g. "van Dyck C. B.") — a lone capital + period.
  out = out.replace(/\b([A-Z])\.(?=\s|$)/g, `$1${DOT}`);

  return out;
}

function unmask(text: string): string {
  return text.split(DOT).join(".");
}

function isLikelyClaim(candidate: string): boolean {
  if (candidate.length < MIN_CLAIM_LENGTH) return false;
  // Must contain at least one letter — pure numbers/symbols aren't claims.
  return /[A-Za-z]/.test(candidate);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Shared, pure input hardening for user-supplied claim / free text on the public
// verification routes (/api/verify, /api/verify/batch, /api/verify/text). This runs
// BEFORE any claim text reaches an LLM, the DB, or the network, and is the single
// place that decides what "an acceptable claim string" is. Keep it deterministic and
// side-effect free — no logging of the text itself.
//
// Rejection rules:
//   - control characters (except common whitespace: tab, newline, carriage return)
//   - text that is effectively empty once control/whitespace is stripped
//   - too long (only when the caller supplies a maxLength — checked BEFORE the
//     repetition heuristic so an over-length blob gets the clearer "too long" error)
//   - absurdly repetitive input (a single character repeated for the whole string),
//     which is a cheap way to burn tokens without expressing a real claim
//
// Minimum length stays a caller concern (the messages differ per route); this helper
// enforces character-quality + the shared max-length + whitespace normalisation.

// C0 (0x00–0x1F) and C1 (0x7F–0x9F) control ranges, excluding tab (0x09),
// line feed (0x0A) and carriage return (0x0D) which are legitimate whitespace.
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

// Zero-width / bidi-control characters that can be used to smuggle hidden or
// direction-flipping content past a human reviewer. Stripped rather than rejected:
//   U+200B–U+200F zero-width chars + LRM/RLM, U+202A–U+202E bidi overrides,
//   U+2060 word joiner, U+FEFF BOM / zero-width no-break space.
const INVISIBLE_CHARS = /[​-‏‪-‮⁠﻿]/g;

export interface SanitizeOptions {
  // When set, input whose cleaned length exceeds this is rejected with `tooLongError`.
  // Checked before the repetition heuristic so length always wins for huge input.
  maxLength?: number;
  // User-facing message for the too-long case (defaults to a generic one). Callers
  // pass their existing wording to stay backward compatible.
  tooLongError?: string;
}

export type ClaimInputResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validate and normalise a user-supplied claim/free-text string.
 *
 * Returns a discriminated result rather than throwing, so route handlers can map
 * failures to a 400 with a user-safe message. On success, `value` is the cleaned
 * string (invisible characters removed, surrounding whitespace trimmed) that the
 * caller should use downstream in place of the raw input.
 */
export function sanitizeClaimText(raw: unknown, options: SanitizeOptions = {}): ClaimInputResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Claim must be a string." };
  }

  // Strip invisible/bidi characters, then normalise. This does not remove the
  // meaningful content of a legitimate claim.
  const cleaned = raw.replace(INVISIBLE_CHARS, "");

  if (CONTROL_CHARS.test(cleaned)) {
    return {
      ok: false,
      error: "Claim contains unsupported control characters. Please paste plain text.",
    };
  }

  const trimmed = cleaned.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Claim must not be empty." };
  }

  // Length cap (when the caller opts in) takes precedence over the repetition
  // heuristic below, so absurdly long input gets the clearer "too long" message.
  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    return {
      ok: false,
      error: options.tooLongError ?? `Input is too long (max ${options.maxLength} characters).`,
    };
  }

  // Reject degenerate input: a single character (ignoring whitespace) repeated for
  // the entire string is never a real efficacy claim and only wastes tokens.
  const nonWhitespace = trimmed.replace(/\s+/g, "");
  if (nonWhitespace.length >= 12 && new Set(nonWhitespace).size === 1) {
    return { ok: false, error: "Claim doesn't look like a real sentence. Please rephrase it." };
  }

  return { ok: true, value: trimmed };
}

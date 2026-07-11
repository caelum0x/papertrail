// ERROR CLASSIFICATION for the CLINICAL TRIAL MATCHER.
//
// During a live demo the shared Anthropic key may be usage-capped (429 rate_limit or
// 403/402 quota/billing) rather than genuinely broken. We must degrade honestly — show the
// coordinator what we could extract and tell them WHY the reasoning is unavailable — instead
// of white-screening on a generic 500. This module gives the pipeline and the route one
// shared way to tell "temporarily usage-capped" apart from a true failure.
//
// It does NOT weaken the grounding moat: it only affects how we REPORT a failure. No result
// is ever fabricated to paper over an outage; a degraded run returns fewer results, honestly.

// Why a stage could not complete. `quota` = the Anthropic key is usage-capped / rate-limited
// (a temporary, explainable condition); `error` = an unexpected failure worth retrying/logging.
export type DegradedReason = "quota" | "error";

// HTTP statuses the Anthropic SDK surfaces when the account/key is usage-capped or throttled:
//   402 payment_required, 403 permission/billing, 429 rate_limit/quota exhausted.
// (529/503/overloaded are transient and already retried in lib/claude.ts, so a 529 that
// reaches here has exhausted its retries and is treated as a plain error.)
const QUOTA_STATUSES = new Set([402, 403, 429]);

// Substrings Anthropic uses in error messages/types for capped or throttled keys, matched
// case-insensitively as a fallback when no numeric status is present on the thrown error.
const QUOTA_HINTS = [
  "rate limit",
  "rate_limit",
  "quota",
  "insufficient",
  "credit balance",
  "billing",
  "usage limit",
  "usage_limit",
  "too many requests",
] as const;

function readStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function readMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

/**
 * True when an error looks like the Anthropic key being usage-capped or rate-limited
 * (a temporary, explainable condition) rather than a genuine bug. Checks the numeric HTTP
 * status first, then falls back to well-known message substrings. Conservative: anything it
 * cannot confidently attribute to a quota/limit is treated as a real error by the caller.
 */
export function isQuotaError(err: unknown): boolean {
  const status = readStatus(err);
  if (status !== undefined && QUOTA_STATUSES.has(status)) return true;

  const message = readMessage(err).toLowerCase();
  return QUOTA_HINTS.some((hint) => message.includes(hint));
}

// Map any thrown error to a DegradedReason for uniform, honest reporting.
export function classifyError(err: unknown): DegradedReason {
  return isQuotaError(err) ? "quota" : "error";
}

// A user-facing, non-sensitive explanation for a degraded run. NEVER echoes the raw error
// (which could contain request context) or any patient text — only a fixed, safe message.
export function degradedMessage(reason: DegradedReason): string {
  if (reason === "quota") {
    return (
      "Claude is temporarily usage-capped, so per-trial eligibility reasoning is paused. " +
      "Any profile shown was extracted before the cap; reload a prior run from the history " +
      "panel to see full reasoning, or try again shortly."
    );
  }
  return (
    "Eligibility reasoning is temporarily unavailable due to an unexpected error. This has " +
    "been logged. Any profile shown was extracted successfully — please try again shortly."
  );
}

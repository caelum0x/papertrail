import type { PlanLimits } from "@/lib/billing/types";

// Pure helpers for quota accounting. Kept dependency-free (no DB, no clock reads
// except the injected `now`) so they can be unit-tested deterministically.

// The default plan for orgs that have never subscribed. Its limits match the
// 'free' plan seeded in migration 0015 so unauthenticated-of-billing orgs still
// get a sane, enforced quota rather than unlimited spend.
export const FREE_PLAN_LIMITS: PlanLimits = {
  verification: 25,
  claim: 100,
  document: 50,
};

// Start of the current metering window. When the org has a subscription with a
// current_period_end, the window is [end - 1 month, end); otherwise it falls
// back to the start of the current calendar month (UTC). This keeps metering
// deterministic and aligned to how a plan renews.
export function periodStart(
  now: Date,
  currentPeriodEnd: string | null
): Date {
  if (currentPeriodEnd) {
    const end = new Date(currentPeriodEnd);
    if (!Number.isNaN(end.getTime())) {
      const start = new Date(end);
      start.setUTCMonth(start.getUTCMonth() - 1);
      // If we're past the period end, meter against the current calendar month
      // instead of a stale window.
      if (start.getTime() <= now.getTime() && now.getTime() < end.getTime()) {
        return start;
      }
    }
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// One calendar month after `start` (UTC) — used to derive a period end when an
// org has no subscription yet.
export function periodEnd(start: Date): Date {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

// The cap for a kind under the given limits. -1 or a missing kind means
// unlimited, represented as null.
export function limitFor(limits: PlanLimits, kind: string): number | null {
  const raw = limits[kind];
  if (raw === undefined || raw < 0) {
    return null;
  }
  return raw;
}

// Whether consuming `quantity` more of `kind` is allowed given `used` so far.
// Unlimited (null limit) is always allowed. Never mutates its inputs.
export function isWithinQuota(
  used: number,
  limit: number | null,
  quantity: number
): boolean {
  if (limit === null) {
    return true;
  }
  return used + quantity <= limit;
}

// Remaining allowance for a kind (null when unlimited), floored at 0.
export function remainingFor(used: number, limit: number | null): number | null {
  if (limit === null) {
    return null;
  }
  return Math.max(0, limit - used);
}

// Fraction 0..1 of a cap consumed. 0 when unlimited (no meaningful ratio).
export function usageRatio(used: number, limit: number | null): number {
  if (limit === null || limit === 0) {
    return 0;
  }
  return Math.min(1, used / limit);
}

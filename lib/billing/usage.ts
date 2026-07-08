import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import {
  getActiveSubscription,
  insertUsageEvent,
  sumUsageSince,
  sumUsageByKindSince,
} from "@/lib/billing/repository";
import {
  FREE_PLAN_LIMITS,
  periodStart,
  periodEnd,
  limitFor,
  isWithinQuota,
  remainingFor,
  usageRatio,
} from "@/lib/billing/period";
import type {
  PlanLimits,
  QuotaDecision,
  UsageSummary,
  UsageMeter,
} from "@/lib/billing/types";

// Usage metering + quota authorization. Call checkQuota BEFORE any billable
// action (Claude call, verification run) and only proceed when `allowed` is
// true; call recordUsage AFTER the action succeeds so failed attempts don't
// burn quota.

// Resolves the effective plan limits and current metering-window start for an
// org: its active subscription's plan, or the free-tier default if it has never
// subscribed. `now` is injectable for deterministic tests.
async function resolveWindow(
  pool: Pool,
  orgId: string,
  now: Date
): Promise<{ limits: PlanLimits; start: Date; end: Date | null }> {
  const sub = await getActiveSubscription(pool, orgId);
  if (!sub) {
    const start = periodStart(now, null);
    return { limits: FREE_PLAN_LIMITS, start, end: periodEnd(start) };
  }
  // The subscription join carries the plan key/name/price but not its limits;
  // fetch the plan's limits directly.
  const { rows } = await pool.query(
    `select limits from plans where id = $1`,
    [sub.planId]
  );
  const limits = (rows[0]?.limits as PlanLimits | undefined) ?? {};
  const start = periodStart(now, sub.currentPeriodEnd);
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  return { limits, start, end };
}

// Records a metered usage event for an org. Best-effort in spirit but surfaces
// DB errors to the caller so a failed record can be retried or logged — it does
// not swallow silently. Never throws for a non-positive quantity (no-op).
export async function recordUsage(
  orgId: string,
  kind: string,
  quantity = 1,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (quantity <= 0) {
    return;
  }
  const pool = getPool();
  await insertUsageEvent(pool, { orgId, kind, quantity, metadata });
}

// Authorizes spend BEFORE it happens. Returns a decision describing whether
// consuming `quantity` more of `kind` stays within the org's plan quota for the
// current period. Unlimited kinds are always allowed.
export async function checkQuota(
  orgId: string,
  kind: string,
  quantity = 1,
  now: Date = new Date()
): Promise<QuotaDecision> {
  const pool = getPool();
  const { limits, start } = await resolveWindow(pool, orgId, now);
  const limit = limitFor(limits, kind);
  const used = await sumUsageSince(pool, orgId, kind, start);
  return {
    kind,
    allowed: isWithinQuota(used, limit, quantity),
    used,
    limit,
    remaining: remainingFor(used, limit),
  };
}

// Builds the full usage snapshot (one meter per quota-bearing kind in the plan)
// for the org's current period — used by GET /api/billing/usage.
export async function getUsageSummary(
  orgId: string,
  now: Date = new Date()
): Promise<UsageSummary> {
  const pool = getPool();
  const { limits, start, end } = await resolveWindow(pool, orgId, now);
  const usedByKind = await sumUsageByKindSince(pool, orgId, start);

  // Meter every kind the plan defines a limit for, plus any kind that has usage
  // but isn't in the plan (so unexpected spend is still visible).
  const kinds = new Set<string>([
    ...Object.keys(limits),
    ...Object.keys(usedByKind),
  ]);

  const meters: UsageMeter[] = Array.from(kinds)
    .sort()
    .map((kind) => {
      const limit = limitFor(limits, kind);
      const used = usedByKind[kind] ?? 0;
      return { kind, used, limit, ratio: usageRatio(used, limit) };
    });

  return {
    periodStart: start.toISOString(),
    periodEnd: end ? end.toISOString() : null,
    meters,
  };
}

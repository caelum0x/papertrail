// In-memory rate limiter, sufficient for a single-instance hackathon deploy.
// If this is deployed to multiple serverless regions/instances, each instance
// has its own counter - acceptable tradeoff for a one-week budget guard rather
// than standing up Redis.

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const max = Number(process.env.RATE_LIMIT_MAX || 10);
  const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
  const now = Date.now();

  const existing = buckets.get(key);
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
  }

  if (existing.count >= max) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: max - existing.count, resetAt: existing.resetAt };
}

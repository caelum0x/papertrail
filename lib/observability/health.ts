import { getPool } from "@/lib/db";
import type { HealthCheck, HealthReport, HealthStatus } from "@/lib/observability/types";

// Composes a health report from live checks + build metadata. Kept dependency-
// light so /api/observability/health can respond even when parts of the system
// are degraded.

function buildInfo(): HealthReport["build"] {
  return {
    commit:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ??
      process.env.GIT_COMMIT?.slice(0, 12) ??
      "dev",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    region: process.env.VERCEL_REGION ?? null,
    node: process.version,
  };
}

// Roll individual check statuses up to an overall status: any "down" -> down,
// any "degraded" -> degraded, else ok.
function rollup(checks: HealthCheck[]): HealthStatus {
  if (checks.some((c) => c.status === "down")) return "down";
  if (checks.some((c) => c.status === "degraded")) return "degraded";
  return "ok";
}

async function checkDatabase(): Promise<HealthCheck> {
  const started = Date.now();
  try {
    await getPool().query("select 1");
    const latencyMs = Date.now() - started;
    return {
      name: "database",
      status: latencyMs > 1000 ? "degraded" : "ok",
      detail: latencyMs > 1000 ? "Slow response from Postgres." : "Reachable.",
      latencyMs,
    };
  } catch (err: unknown) {
    return {
      name: "database",
      status: "down",
      detail: err instanceof Error ? err.message : "Connection failed.",
      latencyMs: Date.now() - started,
    };
  }
}

function checkClaudeConfig(): HealthCheck {
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  return {
    name: "claude_api",
    status: configured ? "ok" : "degraded",
    detail: configured
      ? "API key present."
      : "ANTHROPIC_API_KEY not set — verification will fail.",
    latencyMs: null,
  };
}

export async function buildHealthReport(): Promise<HealthReport> {
  const checks: HealthCheck[] = [await checkDatabase(), checkClaudeConfig()];
  return {
    status: rollup(checks),
    checkedAt: new Date().toISOString(),
    build: buildInfo(),
    checks,
  };
}

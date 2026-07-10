import { NextResponse } from "next/server";
import { checkDbConnection } from "@/lib/db";

// Public, cheap liveness/readiness probe. Pings the DB with a short timeout and
// never throws — /health itself must not 500, or uptime monitors get false
// alarms. No secrets or connection strings are ever included in the payload.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read the app version without importing package.json into the bundle. Falls
// back to a sentinel so a missing env var can't crash the probe.
const VERSION =
  process.env.npm_package_version ??
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  "unknown";

const DB_TIMEOUT_MS = 2000;

// Race the DB check against a timeout so a hung connection can't stall the
// probe. Any failure (rejection or timeout) resolves to false rather than
// propagating — the caller reports "degraded", not a crash.
async function pingDb(): Promise<boolean> {
  try {
    const timeout = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), DB_TIMEOUT_MS)
    );
    return await Promise.race([checkDbConnection(), timeout]);
  } catch {
    return false;
  }
}

export async function GET() {
  let db = false;
  try {
    db = await pingDb();
  } catch {
    db = false;
  }

  // Presence-only key checks: booleans, never the values themselves.
  const anthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const voyageKey = Boolean(process.env.VOYAGE_API_KEY);

  const checks = {
    db,
    anthropic_key: anthropicKey,
    voyage_key: voyageKey,
  };

  // DB is the only hard dependency for the probe's status. Missing model keys
  // degrade LLM features but the service is still up, so they don't fail the DB
  // gate here — they're surfaced in `checks` for operators.
  const status: "ok" | "degraded" = db ? "ok" : "degraded";

  return NextResponse.json(
    {
      status,
      checks,
      version: VERSION,
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}

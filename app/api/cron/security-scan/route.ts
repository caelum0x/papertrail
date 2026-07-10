import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { runOrgSecurityScan } from "@/lib/security/securityScan";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/security-scan — the SCHEDULED entry point for tenant-scoped
// threat detection ("XDR"), hit by Vercel Cron (see vercel.json). Mirrors
// /api/cron/tick: it authenticates via the shared CRON_SECRET bearer token and
// sweeps EVERY org, running the deterministic security detectors and persisting
// new findings. No user session exists here, so there is no RBAC context — the
// secret IS the authorization.

// Constant-time-ish comparison to avoid leaking the secret via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: never run unauthenticated
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return safeEqual(token, secret);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    // Do not reveal whether the secret is merely unset vs. mismatched.
    return fail("Unauthorized.", 401);
  }

  const start = Date.now();
  try {
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>("select id from orgs");

    const totals = {
      orgs: rows.length,
      detected: 0,
      persisted: 0,
      chained: 0,
      erroredOrgs: 0,
    };
    for (const { id } of rows) {
      try {
        const r = await runOrgSecurityScan(pool, id);
        totals.detected += r.detected;
        totals.persisted += r.persisted;
        totals.chained += r.chained;
      } catch (err) {
        // One org's failure must not abort the whole sweep. Log ids/counts
        // only — never any claim/patient text or finding detail.
        totals.erroredOrgs += 1;
        logEvent("cron.security_scan.org_error", {
          orgId: id,
          message: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    logEvent("cron.security_scan.done", {
      ...totals,
      latencyMs: Date.now() - start,
    });
    return ok(totals);
  } catch {
    return fail("Security scan failed.", 500);
  }
}

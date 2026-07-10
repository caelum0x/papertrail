import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { processTick } from "@/lib/jobs/queue";
import { logEvent } from "@/lib/logger";
import { runOrgSecurityScan } from "@/lib/security/securityScan";
import { purgeOrgRetention } from "@/lib/governance/retentionPurge";
import { sweepChainIntegrity } from "@/lib/compliance/chainIntegrity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/tick — the SCHEDULED entry point for background work, hit by
// Vercel Cron (see vercel.json). Unlike /api/jobs/tick (which is session-
// authenticated and processes a single org via x-org-id), this route:
//   1. authenticates via a shared CRON_SECRET bearer token — Vercel Cron sends
//      `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set,
//   2. iterates EVERY org and drains each one's due schedules + runnable jobs,
// which is what a multi-tenant scheduler actually needs. No user session exists
// here, so there is no RBAC context — the secret IS the authorization.

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

    const totals = { orgs: rows.length, processedJobs: 0, completedJobs: 0, failedJobs: 0, firedSchedules: 0 };
    for (const { id } of rows) {
      try {
        const r = await processTick(pool, { orgId: id });
        totals.processedJobs += r.processedJobs;
        totals.completedJobs += r.completedJobs;
        totals.failedJobs += r.failedJobs;
        totals.firedSchedules += r.firedSchedules;
      } catch (err) {
        // One org's failure must not abort the whole sweep.
        logEvent("cron.tick.org_error", { orgId: id, message: err instanceof Error ? err.message : "unknown" });
      }
      // Enterprise daily sweeps folded into the single Vercel-Hobby cron (best-effort;
      // a failure here never aborts the job tick). Threat detection + retention purge
      // run per org; chain integrity is swept once after the loop.
      try { await runOrgSecurityScan(pool, id); } catch { /* best-effort */ }
      try { await purgeOrgRetention(id, pool); } catch { /* best-effort */ }
    }

    let chainIntegrity: { ok: number; broken: number } | null = null;
    try {
      const sweep = await sweepChainIntegrity(rows.map((r) => r.id), pool);
      chainIntegrity = { ok: sweep.ok, broken: sweep.broken };
    } catch {
      /* best-effort: integrity sweep never fails the tick */
    }

    logEvent("cron.tick.done", { ...totals, chainIntegrity, latencyMs: Date.now() - start });
    return ok({ ...totals, chainIntegrity });
  } catch {
    return fail("Cron tick failed.", 500);
  }
}

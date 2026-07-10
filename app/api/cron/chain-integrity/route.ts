import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { logEvent } from "@/lib/logger";
import { sweepChainIntegrity } from "@/lib/compliance/chainIntegrity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/chain-integrity — the SCHEDULED nightly verification of every
// org's WORM audit chain. Like /api/cron/tick this authenticates with the shared
// CRON_SECRET bearer token (Vercel Cron sends it automatically) and iterates
// EVERY org: no user session exists here, so the secret IS the authorization.
//
// For each org it recomputes and verifies the hash chain (lib/compliance/
// chainIntegrity, which reuses the existing verifyChain). A broken seq/hash is
// turned into a high-severity audit entry + a failed control run — it does NOT
// throw, so one org's broken chain never aborts the sweep. The response reports
// COUNTS + break locations (seq numbers) only — never chain contents.

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
    const orgIds = rows.map((r) => r.id);

    const sweep = await sweepChainIntegrity(orgIds, pool);

    // Report broken seq locations for observability — never chain contents.
    const brokenSeqs = sweep.results
      .filter((r) => !r.ok)
      .map((r) => ({ orgId: r.orgId, brokenAtSeq: r.brokenAtSeq, errored: r.errored }));

    logEvent("cron.chain_integrity.done", {
      orgsChecked: sweep.orgsChecked,
      ok: sweep.ok,
      broken: sweep.broken,
      latencyMs: Date.now() - start,
    });

    return ok({
      orgsChecked: sweep.orgsChecked,
      ok: sweep.ok,
      broken: sweep.broken,
      brokenSeqs,
    });
  } catch {
    return fail("Chain integrity sweep failed.", 500);
  }
}

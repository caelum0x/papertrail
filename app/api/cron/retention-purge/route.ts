import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { logEvent } from "@/lib/logger";
import { purgeOrgRetention } from "@/lib/governance/retentionPurge";
import { recordControlRun } from "@/lib/complianceOps/runLedger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/cron/retention-purge — the SCHEDULED enforcement of every org's data
// retention policy. Like /api/cron/tick this authenticates with the shared
// CRON_SECRET bearer token (Vercel Cron sends it automatically) and iterates
// EVERY org: no user session exists here, so the secret IS the authorization.
//
// For each org it purges/anonymizes rows past their configured retention window
// (lib/governance/retentionPurge), audits the run (writeAudit — counts only), and
// records the outcome in the compliance_control_runs ledger so the console can
// surface the last purge run. Best-effort: one org's failure never aborts the
// sweep. The response reports COUNTS only — never any purged content.

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
      deleted: 0,
      anonymized: 0,
      skipped: 0,
      errors: 0,
      orgErrors: 0,
    };

    for (const { id } of rows) {
      try {
        const result = await purgeOrgRetention(id, pool);
        totals.deleted += result.deleted;
        totals.anonymized += result.anonymized;
        totals.skipped += result.skipped;
        totals.errors += result.errors;

        // Audit the run with COUNTS ONLY — no entity_type payloads or contents.
        await writeAudit(pool, {
          orgId: id,
          userId: null,
          action: "compliance.retention.purge",
          entityType: "retention_policy",
          entityId: id,
          metadata: {
            policies: result.policies,
            deleted: result.deleted,
            anonymized: result.anonymized,
            skipped: result.skipped,
            errors: result.errors,
          },
        });

        await recordControlRun(
          {
            orgId: id,
            control: "retention_purge",
            status: result.errors > 0 ? "partial" : "ok",
            reason:
              result.errors > 0 ? `${result.errors} entity type(s) errored` : null,
            detail: {
              policies: result.policies,
              deleted: result.deleted,
              anonymized: result.anonymized,
              skipped: result.skipped,
              errors: result.errors,
            },
          },
          pool
        );
      } catch (err) {
        // One org's failure must not abort the whole sweep. Record it and move on.
        totals.orgErrors += 1;
        logEvent("cron.retention_purge.org_error", {
          orgId: id,
          message: err instanceof Error ? err.message : "unknown",
        });
        await recordControlRun(
          {
            orgId: id,
            control: "retention_purge",
            status: "failed",
            reason: "purge sweep failed",
          },
          pool
        );
      }
    }

    logEvent("cron.retention_purge.done", { ...totals, latencyMs: Date.now() - start });
    return ok(totals);
  } catch {
    return fail("Retention purge failed.", 500);
  }
}

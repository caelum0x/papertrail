import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { requireRole } from "@/lib/authz/rbac";
import { checkRateLimit } from "@/lib/rateLimit";
import { sanitizeClaimText } from "@/lib/api/claimInput";
import { ok, fail } from "@/lib/api/response";
import { writeAudit } from "@/lib/audit";
import { logEvent } from "@/lib/logger";
import { AssessAlertRequestSchema } from "@/lib/alerts/schemas";
import { assessAlert } from "@/lib/alerts/assess";

export const runtime = "nodejs";

// ORG-SCOPED evidence-alert assessment (Trialstreamer-style). Watches are tenant data,
// so this route is org-scoped: given a watched TOPIC (+ optional CURRENT_VERDICT) and a
// candidate NEW SOURCE, Claude reads the source and assesses whether it MATTERS — is it
// relevant, and would it confirm/weaken/overturn the current verdict? The trust layer
// grounds the model's supporting quote to the source before we return it.
//
// Auth + RBAC via withOrg (viewer and above — assessing a candidate is read-only research,
// like copilot). A per-ORG rate budget attributes Claude cost to the tenant and caps abuse
// (each assessment is a full source-reading Claude call). Inputs are hardened BEFORE the
// model or DB sees them. A writeAudit trail records counts only. Standard { success, data,
// error } envelope. NEVER logs the topic, verdict, or source text — only counts/verdicts.
// org_id is taken from ctx (resolved from the session membership), never trusted from the
// client body.

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  const start = Date.now();

  // Any authenticated org member (viewer and above) may assess a candidate source.
  try {
    requireRole(ctx, "viewer");
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Forbidden.", rbacStatus(err) ?? 403);
  }

  // Per-org (not per-IP) budget: attributes Claude cost to the tenant and caps abuse.
  const rate = checkRateLimit(`alerts.assess:${ctx.org.id}`, { max: 10 });
  if (!rate.allowed) {
    logEvent("alerts.assess.rate_limited", { orgId: ctx.org.id });
    return fail("Rate limit reached. Please wait a moment before assessing another source.", 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = AssessAlertRequestSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request.";
    return fail(`Invalid request: ${message}`, 400);
  }

  // Harden every free-text field (control/invisible/bidi chars, degenerate repetition,
  // length caps) BEFORE anything reaches the model. Zod already enforced min/max length;
  // this is the character-quality layer that verify/citations use.
  const topic = sanitizeClaimText(parsed.data.topic, {
    maxLength: 500,
    tooLongError: "Topic is too long (max 500 characters).",
  });
  if (!topic.ok) {
    return fail(`Topic: ${topic.error}`, 400);
  }

  const source = sanitizeClaimText(parsed.data.source_text, {
    maxLength: 20000,
    tooLongError: "Source text is too long (max 20000 characters).",
  });
  if (!source.ok) {
    return fail(`Source text: ${source.error}`, 400);
  }

  let currentVerdict: string | null = null;
  if (parsed.data.current_verdict && parsed.data.current_verdict.trim().length > 0) {
    const v = sanitizeClaimText(parsed.data.current_verdict, {
      maxLength: 2000,
      tooLongError: "Current verdict summary is too long (max 2000 characters).",
    });
    if (!v.ok) {
      return fail(`Current verdict: ${v.error}`, 400);
    }
    currentVerdict = v.value;
  }

  let sourceTitle: string | null = null;
  if (parsed.data.source_title && parsed.data.source_title.trim().length > 0) {
    const t = sanitizeClaimText(parsed.data.source_title, {
      maxLength: 500,
      tooLongError: "Source title is too long (max 500 characters).",
    });
    if (!t.ok) {
      return fail(`Source title: ${t.error}`, 400);
    }
    sourceTitle = t.value;
  }

  try {
    const outcome = await assessAlert({
      topic: topic.value,
      currentVerdict,
      sourceText: source.value,
      sourceTitle,
    });

    // Audit the assessment (counts/verdicts only — never the topic or source text).
    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "alerts.assess",
      entityType: "alert_assessment",
      metadata:
        outcome.status === "assessed"
          ? {
              relevant: outcome.assessment.relevant,
              likely_impact: outcome.assessment.likely_impact,
              grounding_status: outcome.assessment.grounding.status,
            }
          : { status: "ungroundable" },
    });

    if (outcome.status === "ungroundable") {
      logEvent("alerts.assess.ungroundable", {
        orgId: ctx.org.id,
        latencyMs: Date.now() - start,
      });
      return ok(outcome);
    }

    logEvent("alerts.assess.success", {
      orgId: ctx.org.id,
      latencyMs: Date.now() - start,
      relevant: outcome.assessment.relevant,
      likelyImpact: outcome.assessment.likely_impact,
      groundingStatus: outcome.assessment.grounding.status,
      confidence: outcome.assessment.confidence,
    });
    return ok(outcome);
  } catch (err) {
    if (rbacStatus(err) !== null) {
      return fail((err as Error).message, rbacStatus(err) as number);
    }
    logEvent("alerts.assess.error", { orgId: ctx.org.id, latencyMs: Date.now() - start, error: String(err) });
    console.error("[/api/alerts/assess] failed:", err);
    return fail(
      "Something went wrong while assessing this source. This has been logged — please try again, or paste the source's exact abstract.",
      500
    );
  }
});

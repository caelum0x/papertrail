import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import {
  listLegalHolds,
  placeLegalHold,
  releaseLegalHold,
  type LegalHold,
} from "@/lib/governance/legalHold";

// Legal-hold governance API. A legal hold preserves a data subject's data against
// retention purge during litigation / regulatory obligations — an admin-only
// action. All access is org-scoped via withOrg (ctx.org.id) and audited.
export const runtime = "nodejs";

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

const placeSchema = z.object({
  subject: z.string().trim().min(1, "Provide a subject to hold.").max(320),
  reason: z.string().trim().max(1000).optional(),
});

const releaseSchema = z.object({
  id: z.string().uuid("Provide the id of the hold to release."),
});

// GET /api/governance/legal-hold — the org's legal holds, newest-first. Optional
// ?active=true narrows to holds still in force. Admin-only (governance surface).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const url = new URL(req.url);
    const activeOnly = url.searchParams.get("active") === "true";
    const holds = await listLegalHolds(getPool(), ctx.org.id, activeOnly);
    return ok<LegalHold[]>(holds, { total: holds.length });
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't load legal holds. Please try again.", 500);
  }
});

// POST /api/governance/legal-hold — place a hold on a subject. Idempotent: an
// existing active hold for the subject is returned unchanged. Admin-only.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const body = await req.json().catch(() => null);
    const parsed = placeSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid legal hold.", 400);
    }

    const hold = await placeLegalHold(getPool(), ctx.org.id, {
      subject: parsed.data.subject,
      reason: parsed.data.reason ?? null,
      placedBy: ctx.user.id,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "legal_hold.place",
      entityType: "legal_hold",
      entityId: hold.id,
      // ids/flags only — never the raw subject text in logs/metadata.
      metadata: { active: hold.active, has_reason: hold.reason !== null },
    });

    return created<LegalHold>(hold);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't place the legal hold. Please try again.", 500);
  }
});

// DELETE /api/governance/legal-hold — release a hold by id (JSON body { id } or
// ?id=). Returns 404 if there is no active hold with that id. Admin-only.
export const DELETE = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const url = new URL(req.url);
    const fromQuery = url.searchParams.get("id");
    const body = fromQuery ? { id: fromQuery } : await req.json().catch(() => null);
    const parsed = releaseSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid hold id.", 400);
    }

    const released = await releaseLegalHold(getPool(), ctx.org.id, parsed.data.id);
    if (!released) {
      return fail("No active legal hold found with that id.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "legal_hold.release",
      entityType: "legal_hold",
      entityId: released.id,
      metadata: { active: released.active },
    });

    return ok<LegalHold>(released);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't release the legal hold. Please try again.", 500);
  }
});

import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import { updateClaimSchema } from "@/lib/claims/schemas";
import { deleteClaim, getClaim, updateClaim } from "@/lib/claims/repository";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

function rethrowRbac(err: unknown): void {
  if (err instanceof Error && "status" in err) throw err;
}

// GET /api/claims/[id] — a single org-scoped claim.
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "viewer");

      const parsedId = idSchema.safeParse(params?.id);
      if (!parsedId.success) return fail("Invalid claim id.", 400);

      const claim = await getClaim(ctx.org.id, parsedId.data);
      if (!claim) return fail("Claim not found.", 404);

      return ok(claim);
    } catch (err) {
      rethrowRbac(err);
      return fail("Couldn't load the claim. Please try again.", 500);
    }
  }
);

// PATCH /api/claims/[id] — partial update. Requires editor+.
export const PATCH = withOrg(
  async (req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "editor");

      const parsedId = idSchema.safeParse(params?.id);
      if (!parsedId.success) return fail("Invalid claim id.", 400);

      const body = await req.json().catch(() => null);
      const parsed = updateClaimSchema.safeParse(body);
      if (!parsed.success) {
        return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
      }

      const claim = await updateClaim(ctx.org.id, parsedId.data, parsed.data);
      if (!claim) return fail("Claim not found.", 404);

      await writeAudit(getPool(), {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "claim.update",
        entityType: "claim",
        entityId: claim.id,
        metadata: { fields: Object.keys(parsed.data) },
      });

      return ok(claim);
    } catch (err) {
      rethrowRbac(err);
      return fail("Couldn't update the claim. Please try again.", 500);
    }
  }
);

// DELETE /api/claims/[id] — remove a claim. Requires editor+.
export const DELETE = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "editor");

      const parsedId = idSchema.safeParse(params?.id);
      if (!parsedId.success) return fail("Invalid claim id.", 400);

      const removed = await deleteClaim(ctx.org.id, parsedId.data);
      if (!removed) return fail("Claim not found.", 404);

      await writeAudit(getPool(), {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: "claim.delete",
        entityType: "claim",
        entityId: parsedId.data,
      });

      return ok({ id: parsedId.data, deleted: true });
    } catch (err) {
      rethrowRbac(err);
      return fail("Couldn't delete the claim. Please try again.", 500);
    }
  }
);

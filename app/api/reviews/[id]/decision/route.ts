import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { decisionSchema } from "@/lib/reviews/schemas";
import { getReview, decideReview } from "@/lib/reviews/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/reviews/[id]/decision — approve or reject a review with a comment.
// Approvals are an admin responsibility (editors submit, admins approve).
export const POST = withOrg(
  async (req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "admin");
      const id = params?.id;
      if (!id || !UUID_RE.test(id)) {
        return fail("Invalid review id.", 400);
      }

      const json = await req.json().catch(() => null);
      const parsed = decisionSchema.safeParse(json);
      if (!parsed.success) {
        return fail(
          parsed.error.issues[0]?.message ?? "Invalid request body.",
          400
        );
      }

      const pool = getPool();
      const existing = await getReview(pool, ctx.org.id, id);
      if (!existing) {
        return fail("Review not found.", 404);
      }
      if (existing.status === "approved" || existing.status === "rejected") {
        return fail("This review has already been decided.", 409);
      }

      const updated = await decideReview(
        pool,
        ctx.org.id,
        id,
        ctx.user.id,
        parsed.data.decision,
        parsed.data.comment ?? null
      );
      if (!updated) {
        return fail("Review not found.", 404);
      }

      await writeAudit(pool, {
        orgId: ctx.org.id,
        userId: ctx.user.id,
        action: `review.${parsed.data.decision}`,
        entityType: "review",
        entityId: id,
        metadata: {
          decision: parsed.data.decision,
          claimId: updated.claimId,
          projectId: updated.projectId,
        },
      });

      return ok(updated);
    } catch (err: unknown) {
      if (err instanceof Error && "status" in err) {
        return fail(err.message, (err as { status: number }).status);
      }
      return fail("Failed to record decision.", 500);
    }
  }
);

import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { mlrReviewSchema } from "../../lib/schemas";
import {
  createMlrReview,
  getPublication,
  listMlrReviews,
} from "../../lib/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/publications/[id]/mlr — MLR review history for the publication.
// Any member reads.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid publication id.", 400);
    }

    const pool = getPool();
    const publication = await getPublication(pool, ctx.org.id, id);
    if (!publication) {
      return fail("Publication not found.", 404);
    }

    const items = await listMlrReviews(pool, ctx.org.id, id);
    return ok(items);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load MLR reviews.", 500);
  }
});

// POST /api/publications/[id]/mlr — submit an MLR review decision. Editor+
// (reviewers sign off; use the 'review' capability level).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid publication id.", 400);
    }

    const json = await req.json().catch(() => null);
    const parsed = mlrReviewSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const publication = await getPublication(pool, ctx.org.id, id);
    if (!publication) {
      return fail("Publication not found.", 404);
    }

    const review = await createMlrReview(pool, {
      orgId: ctx.org.id,
      publicationId: id,
      reviewerId: ctx.user.id,
      role: parsed.data.role,
      decision: parsed.data.decision,
      comments: parsed.data.comments ?? null,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "publication.mlr_reviewed",
      entityType: "publication",
      entityId: id,
      metadata: { role: review.role, decision: review.decision },
    });

    return created(review);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to submit MLR review.", 500);
  }
});

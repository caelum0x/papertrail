import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createEvalSetSchema } from "@/lib/eval/schemas";
import { listEvalSets, createEvalSet } from "@/lib/eval/queries";

export const runtime = "nodejs";

// GET /api/eval-sets — list labeled eval sets for the org (paginated). Any
// member (viewer+) may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listEvalSets(getPool(), {
      orgId: ctx.org.id,
      limit,
      offset,
    });
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load eval sets.", 500);
  }
});

// POST /api/eval-sets — create a labeled eval set. Editors and above.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");
    const json = await req.json().catch(() => null);
    const parsed = createEvalSetSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const set = await createEvalSet(pool, {
      orgId: ctx.org.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "eval_set.created",
      entityType: "eval_set",
      entityId: set.id,
      metadata: { name: set.name },
    });

    return created(set);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create eval set.", 500);
  }
});

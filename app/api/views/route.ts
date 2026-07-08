import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createViewSchema, isViewResource } from "@/lib/views/types";
import {
  listViews,
  countViews,
  createView,
  findViewByName,
  type ViewFilters,
} from "@/lib/views/queries";

// GET /api/views — paginated list of the caller's own views plus shared views
// in the org. Optional ?resource filter. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);

    const resourceParam = url.searchParams.get("resource");
    if (resourceParam && !isViewResource(resourceParam)) {
      return fail("Invalid resource.", 400);
    }
    const filters: ViewFilters = { resource: resourceParam ?? undefined };

    const pool = getPool();
    const [views, total] = await Promise.all([
      listViews(pool, ctx.org.id, ctx.user.id, filters, limit, offset),
      countViews(pool, ctx.org.id, ctx.user.id, filters),
    ]);
    return ok(views, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load views.", 500);
  }
});

// POST /api/views — save a new view (editor+). Enforces a per-owner unique name
// within the resource. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createViewSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();

    const duplicate = await findViewByName(
      pool,
      ctx.org.id,
      ctx.user.id,
      parsed.data.resource,
      parsed.data.name
    );
    if (duplicate) {
      return fail("You already have a view with this name.", 409);
    }

    const view = await createView(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      name: parsed.data.name,
      resource: parsed.data.resource,
      query: parsed.data.query,
      shared: parsed.data.shared ?? false,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "view.create",
      entityType: "saved_view",
      entityId: view.id,
      metadata: { name: view.name, resource: view.resource, shared: view.shared },
    });

    return created(view);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to save view.", 500);
  }
});

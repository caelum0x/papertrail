import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import {
  createClaimSchema,
  listClaimsFilterSchema,
} from "@/lib/claims/schemas";
import { createClaim, listClaims } from "@/lib/claims/repository";

export const runtime = "nodejs";

// GET /api/claims — paginated list of the org's claims, filterable by project,
// status, and free-text search (?project_id, ?status, ?q, ?page, ?limit).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const parsedFilter = listClaimsFilterSchema.safeParse({
      project_id: url.searchParams.get("project_id") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    if (!parsedFilter.success) {
      return fail(parsedFilter.error.issues[0]?.message ?? "Invalid filter.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listClaims({
      orgId: ctx.org.id,
      filter: parsedFilter.data,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) throw err;
    return fail("Couldn't load claims. Please try again.", 500);
  }
});

// POST /api/claims — create a new claim in the org. Requires editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createClaimSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const claim = await createClaim({
      orgId: ctx.org.id,
      submittedBy: ctx.user.id,
      ...parsed.data,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "claim.create",
      entityType: "claim",
      entityId: claim.id,
      metadata: { status: claim.status, project_id: claim.project_id },
    });

    return created(claim);
  } catch (err) {
    if (err instanceof Error && "status" in err) throw err;
    return fail("Couldn't create the claim. Please try again.", 500);
  }
});

import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { attachClaimsSchema } from "../../lib/schemas";
import {
  attachClaims,
  getPublication,
  listPublicationClaims,
} from "../../lib/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/publications/[id]/claims — attached claims with verification state.
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

    const items = await listPublicationClaims(pool, ctx.org.id, id);
    return ok(items);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load attached claims.", 500);
  }
});

// POST /api/publications/[id]/claims — attach verified claims. Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid publication id.", 400);
    }

    const json = await req.json().catch(() => null);
    const parsed = attachClaimsSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const publication = await getPublication(pool, ctx.org.id, id);
    if (!publication) {
      return fail("Publication not found.", 404);
    }

    const result = await attachClaims(
      pool,
      ctx.org.id,
      id,
      parsed.data.claimIds
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "publication.claims_attached",
      entityType: "publication",
      entityId: id,
      metadata: { attached: result.attached, skipped: result.skipped },
    });

    return created(result);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to attach claims.", 500);
  }
});

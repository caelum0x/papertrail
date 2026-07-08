import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createTagSchema } from "@/lib/tags/types";
import {
  listTags,
  countTags,
  createTag,
  getTag,
  findTagByName,
  type TagFilters,
} from "@/lib/tags/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_COLOR = "#64748b";

// GET /api/tags — paginated, org-scoped list. Optional ?parentId & ?search
// (name ILIKE) filters. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);

    const parentId = url.searchParams.get("parentId") ?? undefined;
    if (parentId && !UUID_RE.test(parentId)) {
      return fail("Invalid parent id.", 400);
    }
    const search = url.searchParams.get("search")?.trim() || undefined;
    const filters: TagFilters = { parentId, search };

    const pool = getPool();
    const [tags, total] = await Promise.all([
      listTags(pool, ctx.org.id, filters, limit, offset),
      countTags(pool, ctx.org.id, filters),
    ]);
    return ok(tags, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load tags.", 500);
  }
});

// POST /api/tags — create a tag (editor+). Enforces per-org unique name and a
// valid parent. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createTagSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();

    const duplicate = await findTagByName(pool, ctx.org.id, parsed.data.name);
    if (duplicate) {
      return fail("A tag with this name already exists.", 409);
    }

    const parentId = parsed.data.parentId ?? null;
    if (parentId) {
      const parent = await getTag(pool, ctx.org.id, parentId);
      if (!parent) {
        return fail("Parent tag not found.", 404);
      }
    }

    const tag = await createTag(pool, {
      orgId: ctx.org.id,
      name: parsed.data.name,
      color: parsed.data.color ?? DEFAULT_COLOR,
      parentId,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "tag.create",
      entityType: "tag",
      entityId: tag.id,
      metadata: { name: tag.name, parentId: tag.parentId },
    });

    return created(tag);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create tag.", 500);
  }
});

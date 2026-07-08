import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import {
  createTaggingSchema,
  entityTypeSchema,
} from "@/lib/tags/types";
import {
  attachTagging,
  detachTagging,
  listTagsForEntity,
  getTag,
} from "@/lib/tags/queries";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/taggings?entity_type&entity_id — tags currently on an entity. Used by
// TagPicker in other modules to render current selections. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const url = new URL(req.url);
    const entityTypeRaw = url.searchParams.get("entity_type");
    const entityId = url.searchParams.get("entity_id");

    const entityTypeParsed = entityTypeSchema.safeParse(entityTypeRaw);
    if (!entityTypeParsed.success) {
      return fail("Invalid or missing entity_type.", 400);
    }
    if (!entityId || !UUID_RE.test(entityId)) {
      return fail("Invalid or missing entity_id.", 400);
    }

    const pool = getPool();
    const tags = await listTagsForEntity(
      pool,
      ctx.org.id,
      entityTypeParsed.data,
      entityId
    );
    return ok(tags, { total: tags.length });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load taggings.", 500);
  }
});

// POST /api/taggings — attach a tag to an entity (editor+). Idempotent. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createTaggingSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const tag = await getTag(pool, ctx.org.id, parsed.data.tagId);
    if (!tag) {
      return fail("Tag not found.", 404);
    }

    const tagging = await attachTagging(pool, {
      orgId: ctx.org.id,
      tagId: parsed.data.tagId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "tagging.attach",
      entityType: "tagging",
      entityId: tagging.id,
      metadata: {
        tagId: tagging.tagId,
        targetType: tagging.entityType,
        targetId: tagging.entityId,
      },
    });

    return created(tagging);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to attach tag.", 500);
  }
});

// DELETE /api/taggings?tag_id&entity_type&entity_id — detach a tag from an
// entity (editor+). Audited. Query-param based so callers don't need a body.
export const DELETE = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");
    const url = new URL(req.url);
    const tagId = url.searchParams.get("tag_id");
    const entityTypeRaw = url.searchParams.get("entity_type");
    const entityId = url.searchParams.get("entity_id");

    if (!tagId || !UUID_RE.test(tagId)) {
      return fail("Invalid or missing tag_id.", 400);
    }
    const entityTypeParsed = entityTypeSchema.safeParse(entityTypeRaw);
    if (!entityTypeParsed.success) {
      return fail("Invalid or missing entity_type.", 400);
    }
    if (!entityId || !UUID_RE.test(entityId)) {
      return fail("Invalid or missing entity_id.", 400);
    }

    const pool = getPool();
    const removed = await detachTagging(
      pool,
      ctx.org.id,
      tagId,
      entityTypeParsed.data,
      entityId
    );
    if (!removed) {
      return fail("Tagging not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "tagging.detach",
      entityType: "tagging",
      metadata: {
        tagId,
        targetType: entityTypeParsed.data,
        targetId: entityId,
      },
    });

    return ok({ tagId, entityType: entityTypeParsed.data, entityId, detached: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to detach tag.", 500);
  }
});

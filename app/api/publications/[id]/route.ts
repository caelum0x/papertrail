import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updatePublicationSchema } from "../lib/schemas";
import { getPublication, updatePublication } from "../lib/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/publications/[id] — single publication detail with counts. Any member.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid publication id.", 400);
    }

    const publication = await getPublication(getPool(), ctx.org.id, id);
    if (!publication) {
      return fail("Publication not found.", 404);
    }
    return ok(publication);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load publication.", 500);
  }
});

// PATCH /api/publications/[id] — edit metadata / advance status & stage. Editor+.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid publication id.", 400);
    }

    const json = await req.json().catch(() => null);
    const parsed = updatePublicationSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const existing = await getPublication(pool, ctx.org.id, id);
    if (!existing) {
      return fail("Publication not found.", 404);
    }

    const updated = await updatePublication(pool, ctx.org.id, id, {
      title: parsed.data.title,
      type: parsed.data.type,
      targetJournal:
        parsed.data.targetJournal === undefined
          ? undefined
          : parsed.data.targetJournal ?? null,
      status: parsed.data.status,
      stage: parsed.data.stage,
    });
    if (!updated) {
      return fail("Publication not found.", 404);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "publication.updated",
      entityType: "publication",
      entityId: id,
      metadata: { status: updated.status, stage: updated.stage },
    });

    return ok(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update publication.", 500);
  }
});

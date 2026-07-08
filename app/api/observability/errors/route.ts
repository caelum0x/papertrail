import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { errorsQuerySchema, ingestErrorSchema } from "@/lib/observability/schemas";
import { ingestError, listErrors } from "@/lib/observability/queries";

export const runtime = "nodejs";

// GET /api/observability/errors — paginated error events, newest first, with
// optional ?level= and ?q= filters. Viewer+.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const url = new URL(req.url);
    const parsed = errorsQuerySchema.safeParse({
      level: url.searchParams.get("level") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listErrors(
      getPool(),
      ctx.org.id,
      parsed.data,
      limit,
      offset
    );
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load error events.", 500);
  }
});

// POST /api/observability/errors — ingest one error event. Editors and above
// (this is a write into the org's error stream).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");
    const json = await req.json().catch(() => null);
    const parsed = ingestErrorSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const event = await ingestError(pool, ctx.org.id, parsed.data);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "error_event.ingested",
      entityType: "error_event",
      entityId: event.id,
      metadata: { level: event.level },
    });

    return created(event);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to ingest error event.", 500);
  }
});

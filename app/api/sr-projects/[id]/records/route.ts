import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { importRecordsSchema, recordsQuerySchema } from "../../lib/schemas";
import {
  getSrProject,
  importRecords,
  listRecords,
} from "../../lib/repository";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/sr-projects/[id]/records — the screening queue. Any member reads.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid review id.", 400);
    }

    const url = new URL(req.url);
    const parsed = recordsQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const pool = getPool();
    const project = await getSrProject(pool, ctx.org.id, id);
    if (!project) {
      return fail("Systematic review not found.", 404);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listRecords(pool, {
      orgId: ctx.org.id,
      srProjectId: id,
      status: parsed.data.status,
      limit,
      offset,
    });

    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load records.", 500);
  }
});

// POST /api/sr-projects/[id]/records — import candidate records. Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid review id.", 400);
    }

    const json = await req.json().catch(() => null);
    const parsed = importRecordsSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const project = await getSrProject(pool, ctx.org.id, id);
    if (!project) {
      return fail("Systematic review not found.", 404);
    }

    const result = await importRecords(
      pool,
      ctx.org.id,
      id,
      ctx.user.id,
      parsed.data.records.map((r) => ({
        sourceType: r.sourceType,
        externalId: r.externalId ?? null,
        title: r.title,
        abstract: r.abstract ?? null,
      }))
    );

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "sr_records.imported",
      entityType: "sr_project",
      entityId: id,
      metadata: { imported: result.imported, duplicates: result.duplicates },
    });

    return created(result);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to import records.", 500);
  }
});

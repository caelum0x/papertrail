import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createDefinitionSchema, isReportType } from "@/lib/reporting/types";
import {
  listDefinitions,
  countDefinitions,
  createDefinition,
  findDefinitionByName,
  type DefinitionFilters,
} from "@/lib/reporting/queries";

// GET /api/report-definitions — paginated list of the org's report definitions.
// Optional ?type filter. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);

    const typeParam = url.searchParams.get("type");
    if (typeParam && !isReportType(typeParam)) {
      return fail("Invalid report type.", 400);
    }
    const filters: DefinitionFilters = { type: typeParam ?? undefined };

    const pool = getPool();
    const [definitions, total] = await Promise.all([
      listDefinitions(pool, ctx.org.id, filters, limit, offset),
      countDefinitions(pool, ctx.org.id, filters),
    ]);
    return ok(definitions, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load report definitions.", 500);
  }
});

// POST /api/report-definitions — create a definition (editor+). Enforces a
// unique name within the org. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createDefinitionSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();

    const duplicate = await findDefinitionByName(
      pool,
      ctx.org.id,
      parsed.data.name
    );
    if (duplicate) {
      return fail("A report with this name already exists.", 409);
    }

    const definition = await createDefinition(pool, {
      orgId: ctx.org.id,
      createdBy: ctx.user.id,
      name: parsed.data.name,
      type: parsed.data.type,
      layout: parsed.data.layout,
      filters: parsed.data.filters,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "report_definition.create",
      entityType: "report_definition",
      entityId: definition.id,
      metadata: { name: definition.name, type: definition.type },
    });

    return created(definition);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create report definition.", 500);
  }
});

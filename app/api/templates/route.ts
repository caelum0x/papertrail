import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getPool } from "@/lib/db";
import {
  createTemplate,
  createTemplateSchema,
  listTemplates,
  templateKindSchema,
  type ListTemplatesFilters,
  type Template,
} from "./repository";

export const runtime = "nodejs";

// GET /api/templates — paginated list of the org's templates. Supports
// ?kind=<claim|report|verification|document> and ?category=<name>. Any member
// may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);

    const url = new URL(req.url);
    const filters: ListTemplatesFilters = {};

    const rawKind = url.searchParams.get("kind");
    if (rawKind) {
      const parsedKind = templateKindSchema.safeParse(rawKind);
      if (!parsedKind.success) {
        return fail("Invalid kind filter.", 400);
      }
      filters.kind = parsedKind.data;
    }

    const rawCategory = url.searchParams.get("category");
    if (rawCategory) {
      filters.category = rawCategory.trim().slice(0, 80);
    }

    const { items, total } = await listTemplates(
      ctx.org.id,
      limit,
      offset,
      filters
    );
    return ok<Template[]>(items, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load templates. Please try again.", 500);
  }
});

// POST /api/templates — create a new template. Requires editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const template = await createTemplate({
      orgId: ctx.org.id,
      createdBy: ctx.user.id,
      ...parsed.data,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "template.create",
      entityType: "template",
      entityId: template.id,
      metadata: {
        kind: template.kind,
        name: template.name,
        category: template.category,
      },
    });

    return created<Template>(template);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't create the template. Please try again.", 500);
  }
});

import type { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/authz/rbac";
import { CreateExperimentInputSchema } from "@/lib/labNotebook/schemas";
import { createExperiment, listExperiments } from "@/lib/labNotebook/repository";

export const runtime = "nodejs";

// GET /api/lab-notebook — paginated, org-scoped list of saved experiments. Optional
// ?q full-text search (websearch_to_tsquery over title + raw_notes). Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() || undefined;

    const { items, total } = await listExperiments(getPool(), ctx.org.id, {
      q,
      limit,
      offset,
    });
    return ok(items, { total, page, limit });
  } catch (err) {
    console.error("[/api/lab-notebook] list failed:", err);
    return fail("Failed to load experiments.", 500);
  }
});

// POST /api/lab-notebook — persist a reviewed, grounded experiment record. Editor+.
// The `structured` payload is re-validated against StructuredExperimentSchema by the
// input schema. NEVER logs the raw notes — only the created id.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  requireRole(ctx, "editor");

  const body = await req.json().catch(() => null);
  const parsed = CreateExperimentInputSchema.safeParse(body);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid experiment record.", 400);
  }

  try {
    const record = await createExperiment(
      getPool(),
      ctx.org.id,
      ctx.user.id,
      parsed.data
    );
    return created(record);
  } catch (err) {
    console.error("[/api/lab-notebook] create failed:", err);
    return fail("Couldn't save this experiment. Please try again.", 500);
  }
});

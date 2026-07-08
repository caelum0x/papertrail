import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createEvalCaseSchema } from "@/lib/eval/schemas";
import { getEvalSet, listEvalCases, createEvalCase } from "@/lib/eval/queries";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/eval-sets/[id]/cases — list the labeled cases in a set (paginated).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid eval set id.", 400);
    }
    const pool = getPool();
    const set = await getEvalSet(pool, ctx.org.id, id);
    if (!set) {
      return fail("Eval set not found.", 404);
    }

    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listEvalCases(pool, {
      orgId: ctx.org.id,
      evalSetId: id,
      limit,
      offset,
    });
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load eval cases.", 500);
  }
});

// POST /api/eval-sets/[id]/cases — add a labeled case to a set. Editors and above.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id || !UUID_RE.test(id)) {
      return fail("Invalid eval set id.", 400);
    }
    const pool = getPool();
    const set = await getEvalSet(pool, ctx.org.id, id);
    if (!set) {
      return fail("Eval set not found.", 404);
    }

    const json = await req.json().catch(() => null);
    const parsed = createEvalCaseSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const evalCase = await createEvalCase(pool, {
      orgId: ctx.org.id,
      evalSetId: id,
      claim: parsed.data.claim,
      sourceExternalId: parsed.data.source_external_id ?? null,
      expectedDiscrepancyType: parsed.data.expected_discrepancy_type,
      expectedSubstrings: parsed.data.expected_substrings ?? [],
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "eval_case.created",
      entityType: "eval_case",
      entityId: evalCase.id,
      metadata: {
        evalSetId: id,
        expectedDiscrepancyType: evalCase.expectedDiscrepancyType,
      },
    });

    return created(evalCase);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create eval case.", 500);
  }
});

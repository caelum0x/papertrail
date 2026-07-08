import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createExperimentSchema } from "@/lib/flags/schemas";
import {
  listExperiments,
  createExperiment,
} from "@/lib/flags/repository";
import { EXPERIMENT_STATUSES, type Experiment } from "@/lib/flags/types";

export const runtime = "nodejs";

// GET /api/experiments — list this org's experiments, newest first, paginated.
// Optional ?status filter. Any member (viewer+) may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const url = new URL(req.url);
    const rawStatus = url.searchParams.get("status") ?? undefined;
    if (
      rawStatus &&
      !(EXPERIMENT_STATUSES as readonly string[]).includes(rawStatus)
    ) {
      return fail("Invalid status filter.", 400);
    }
    const { limit, offset, page } = parsePagination(req);

    const { items, total } = await listExperiments(getPool(), {
      orgId: ctx.org.id,
      status: rawStatus,
      limit,
      offset,
    });
    return ok<Experiment[]>(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load experiments.", 500);
  }
});

// POST /api/experiments — create an experiment. Admin+ only.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => null);
    const parsed = createExperimentSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const experiment = await createExperiment(getPool(), {
      orgId: ctx.org.id,
      key: parsed.data.key,
      name: parsed.data.name,
      status: parsed.data.status,
      variants: parsed.data.variants,
    }).catch((err: unknown) => {
      // Unique-violation on (org, key) → friendly 409 upstream.
      if (
        err &&
        typeof err === "object" &&
        (err as { code?: string }).code === "23505"
      ) {
        return null;
      }
      throw err;
    });

    if (!experiment) {
      return fail("An experiment with this key already exists.", 409);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "experiment.created",
      entityType: "experiment",
      entityId: experiment.id,
      metadata: {
        key: experiment.key,
        status: experiment.status,
        variantCount: experiment.variants.length,
      },
    });

    return created<Experiment>(experiment);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create experiment.", 500);
  }
});

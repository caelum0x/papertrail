import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { rangeQuerySchema } from "@/lib/apiusage/schemas";
import { getUsageSummary } from "@/lib/apiusage/queries";
import type { UsageSummary } from "@/lib/apiusage/types";

export const runtime = "nodejs";

// GET /api/api-usage/summary — org-scoped usage totals: request count, error
// rate, latency, rate-limit count, plus top-N by-route and by-key breakdowns
// over a ?days window. Viewing usage analytics touches org telemetry, so it is
// gated at admin (same level as view_audit / manage_api_keys).
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const url = new URL(req.url);
    const parsed = rangeQuerySchema.safeParse({
      days: url.searchParams.get("days") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const summary = await getUsageSummary(ctx.org.id, parsed.data.days);

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "api_usage.summary_viewed",
      entityType: "api_usage",
      metadata: { rangeDays: parsed.data.days },
    });

    return ok<UsageSummary>(summary);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load API usage summary. Please try again.", 500);
  }
});

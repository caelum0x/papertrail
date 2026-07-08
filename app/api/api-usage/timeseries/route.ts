import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { timeseriesQuerySchema } from "@/lib/apiusage/schemas";
import { getUsageTimeseries } from "@/lib/apiusage/queries";
import type { UsageTimeseries } from "@/lib/apiusage/types";

export const runtime = "nodejs";

// GET /api/api-usage/timeseries — org-scoped request/error/latency series bucketed
// by hour/day/week over a ?days window, for the usage chart. Admin+.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const url = new URL(req.url);
    const parsed = timeseriesQuerySchema.safeParse({
      days: url.searchParams.get("days") ?? undefined,
      bucket: url.searchParams.get("bucket") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const series = await getUsageTimeseries(
      ctx.org.id,
      parsed.data.days,
      parsed.data.bucket
    );

    return ok<UsageTimeseries>(series);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Couldn't load API usage timeseries. Please try again.", 500);
  }
});

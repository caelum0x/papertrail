import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { metricsQuerySchema } from "@/lib/observability/schemas";
import { listMetricNames, metricSeries } from "@/lib/observability/queries";
import type { MetricSeries } from "@/lib/observability/types";

export const runtime = "nodejs";

// GET /api/observability/metrics — time-series data. With ?metric= returns a
// single bucketed series; without it returns a series for every known metric.
// Query: ?metric=&window=1h|6h|24h|7d|30d&buckets=. Viewer+.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const url = new URL(req.url);
    const parsed = metricsQuerySchema.safeParse({
      metric: url.searchParams.get("metric") ?? undefined,
      window: url.searchParams.get("window") ?? undefined,
      buckets: url.searchParams.get("buckets") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const pool = getPool();
    const query = parsed.data;

    const names = query.metric
      ? [query.metric]
      : await listMetricNames(pool, ctx.org.id);

    const series: MetricSeries[] = [];
    for (const name of names) {
      series.push(await metricSeries(pool, ctx.org.id, name, query));
    }

    return ok({ metrics: names, window: query.window, series });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load metrics.", 500);
  }
});

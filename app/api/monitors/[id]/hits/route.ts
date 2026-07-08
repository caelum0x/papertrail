import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getMonitorById, listHits } from "@/lib/monitoring/repo";
import { MONITOR_HIT_STATUSES, type MonitorHitStatus } from "@/lib/monitoring/types";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

function parseStatus(value: string | null): MonitorHitStatus | undefined {
  if (value && (MONITOR_HIT_STATUSES as readonly string[]).includes(value)) {
    return value as MonitorHitStatus;
  }
  return undefined;
}

// GET /api/monitors/[id]/hits — paginated, org-scoped hits for a monitor.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    const parsedId = idSchema.safeParse(params?.id);
    if (!parsedId.success) {
      return fail("Invalid monitor id.", 400);
    }

    const monitor = await getMonitorById(ctx.org.id, parsedId.data);
    if (!monitor) {
      return fail("Monitor not found.", 404);
    }

    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);

    const { items, total } = await listHits({
      orgId: ctx.org.id,
      monitorId: parsedId.data,
      limit,
      offset,
      status: parseStatus(url.searchParams.get("status")),
    });

    return ok(items, { total, page, limit });
  } catch {
    return fail("Couldn't load hits. Please try again.", 500);
  }
});

import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { getPool } from "@/lib/db";
import { ok, fail } from "@/lib/api/response";
import { summarizeUsage } from "@/lib/metering/engineUsage";
import { summarizeUsageSchema } from "@/lib/metering/engineUsage.schemas";

export const runtime = "nodejs";

// GET /api/usage/engines — the org's per-engine usage summary (call counts, unit
// totals, and Claude-token totals). Any authenticated member may view usage; this
// is a read, so no requireRole. An optional ?since=<ISO> narrows the window. The
// org id comes from the resolved ctx, never the client, so a member can only ever
// see their own org's consumption.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    const rawSince = new URL(req.url).searchParams.get("since");
    const parsed = summarizeUsageSchema.safeParse({
      orgId: ctx.org.id,
      since: rawSince ?? undefined,
    });
    if (!parsed.success) {
      return fail("Invalid 'since' query parameter.", 400);
    }

    const summary = await summarizeUsage(getPool(), {
      orgId: ctx.org.id,
      since: parsed.data.since,
    });
    return ok(summary);
  } catch {
    return fail("Failed to load engine usage.", 500);
  }
});

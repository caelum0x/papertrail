import { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { securityEventsQuerySchema } from "@/lib/security/schemas";
import { listSecurityEvents, getSeverityCounts } from "@/lib/security/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/security/events — the org's threat-detection ("XDR") feed, newest
// first. Optional ?severity filter and standard pagination. Any member
// (viewer+) may read: security findings are read-only telemetry, and gating
// them behind admin would hide the platform's posture from the very engineers
// integrating against it. Returns the paginated feed plus per-severity counts
// in `meta.severityCounts` so the dashboard can render summary cards in one
// round-trip. Findings carry only ids/counts — never raw claim/patient text.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");

    const url = new URL(req.url);
    const parsed = securityEventsQuerySchema.safeParse({
      severity: url.searchParams.get("severity") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid query.", 400);
    }

    const { limit, offset, page } = parsePagination(req);
    const pool = getPool();

    const [{ items, total }, severityCounts] = await Promise.all([
      listSecurityEvents(
        {
          orgId: ctx.org.id,
          severity: parsed.data.severity ?? null,
          limit,
          offset,
        },
        pool
      ),
      getSeverityCounts(ctx.org.id, pool),
    ]);

    return ok(
      { events: items, severityCounts },
      { total, page, limit }
    );
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load security events.", 500);
  }
});

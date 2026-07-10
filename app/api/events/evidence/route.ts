import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import {
  countEvidenceEvents,
  listEvidenceEvents,
} from "@/lib/events/evidenceEvents";
import {
  isEvidenceEventType,
  type EvidenceEventLogEntry,
} from "@/lib/events/evidenceEvents.schemas";

export const runtime = "nodejs";

// GET /api/events/evidence — paginated, org-scoped log of emitted evidence
// lifecycle events (evidence.verified, dossier.built, dossier.published,
// signal.detected). Optional ?type= filter, validated against the known event
// catalogue. This is the source-side audit view of what fired, distinct from the
// per-endpoint delivery history under /api/webhooks. Admin+ only — the event log
// is governance/audit data, aligned with the webhook subsystem's admin gate.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);

    const rawType = new URL(req.url).searchParams.get("type");
    if (rawType !== null && !isEvidenceEventType(rawType)) {
      return fail("Unknown evidence event type.", 400);
    }
    const eventType = rawType ?? undefined;

    const [total, events] = await Promise.all([
      countEvidenceEvents(pool, ctx.org.id, eventType),
      listEvidenceEvents(pool, ctx.org.id, { limit, offset, eventType }),
    ]);

    return ok<EvidenceEventLogEntry[]>(events, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load evidence events.", 500);
  }
});

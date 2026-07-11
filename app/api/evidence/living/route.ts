import type { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import {
  createMonitor,
  listMonitors,
  recordEvent,
  createMonitorSchema,
} from "@/lib/livingEvidence/monitor";

// Org-scoped living-evidence monitor collection.
//
//   GET  /api/evidence/living  — paginated list of the org's monitors, newest
//        first. Any member (viewer+) may read.
//   POST /api/evidence/living  — create a monitor for a topic/claim with an
//        optional baseline body of studies. Editor+.
//
// The monitor's flip verdict itself is computed by the public deterministic
// compute route at /api/evidence/living/assess — no LLM touches the numbers.
export const runtime = "nodejs";

export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const { items, total } = await listMonitors(ctx.org.id, limit, offset);
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    if (err instanceof Error && typeof (err as { status?: unknown }).status === "number") {
      return fail(err.message, (err as unknown as { status: number }).status);
    }
    console.error("[/api/evidence/living GET] failed:", err);
    return fail("Failed to load living-evidence monitors.", 500);
  }
});

export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const raw = await req.json().catch(() => null);
    const parsed = createMonitorSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
      return fail(`Invalid monitor — ${where}${issue?.message ?? "check your inputs."}`, 400);
    }

    const monitor = await createMonitor(ctx.org.id, ctx.user.id, parsed.data);

    // Seed the timeline with a deterministic 'created' event (ids/counts only).
    await recordEvent(ctx.org.id, monitor.id, "created", {
      baselineCount: parsed.data.baseline?.length ?? 0,
    });

    return created(monitor);
  } catch (err: unknown) {
    if (err instanceof Error && typeof (err as { status?: unknown }).status === "number") {
      return fail(err.message, (err as unknown as { status: number }).status);
    }
    console.error("[/api/evidence/living POST] failed:", err);
    return fail("Failed to create living-evidence monitor.", 500);
  }
});

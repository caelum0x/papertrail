import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createFeedbackSchema } from "@/lib/help/types";
import { createFeedback } from "@/lib/help/queries";

// POST /api/feedback — submit lightweight product feedback (bug/idea/praise/other).
// Any member (viewer+) may submit. Audited (message omitted from metadata to keep
// free-text out of the audit log).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const raw = await req.json().catch(() => null);
    const parsed = createFeedbackSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const entry = await createFeedback(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      kind: parsed.data.kind,
      message: parsed.data.message,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "feedback.create",
      entityType: "feedback",
      entityId: entry.id,
      metadata: { kind: entry.kind },
    });

    return created(entry);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to submit feedback.", 500);
  }
});

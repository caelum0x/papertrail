import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getOrgSettings, updateOrgSettings } from "@/lib/org-team/repository";
import { updateOrgSchema } from "@/lib/org-team/schemas";
import type { OrgSettings } from "@/lib/org-team/types";

export const runtime = "nodejs";

function statusOf(err: unknown): number | null {
  if (err instanceof Error && "status" in err) {
    return (err as { status: number }).status;
  }
  return null;
}

// GET /api/org — current org settings. Any member (viewer+) may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const settings = await getOrgSettings(getPool(), ctx.org.id);
    if (!settings) return fail("Organization not found.", 404);
    return ok<OrgSettings>(settings);
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Failed to load organization.", s ?? 500);
  }
});

// PATCH /api/org — update name/slug/settings. Admin+ only.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => null);
    const parsed = updateOrgSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const result = await updateOrgSettings(getPool(), ctx.org.id, parsed.data);
    if (result === "slug_taken") {
      return fail("That slug is already in use.", 409);
    }
    if (!result) {
      return fail("Organization not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "org.update",
      entityType: "org",
      entityId: ctx.org.id,
      metadata: { ...parsed.data },
    });
    return ok<OrgSettings>(result);
  } catch (err) {
    const s = statusOf(err);
    return fail(s ? "Forbidden." : "Failed to update organization.", s ?? 500);
  }
});

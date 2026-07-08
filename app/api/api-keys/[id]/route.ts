import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { revokeApiKey } from "@/lib/admin-audit/repository";
import type { ApiKeySummary } from "@/lib/admin-audit/types";

export const runtime = "nodejs";

// DELETE /api/api-keys/[id] — soft-revoke an API key (kept for audit history).
// Admin+ only.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("API key id is required.", 400);

    const pool = getPool();
    const revoked = await revokeApiKey(pool, ctx.org.id, id);
    if (!revoked) return fail("API key not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "api_key.revoke",
      entityType: "api_key",
      entityId: id,
      metadata: { name: revoked.name, keyPrefix: revoked.keyPrefix },
    });

    return ok<ApiKeySummary>(revoked);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to revoke API key.", 500);
  }
});

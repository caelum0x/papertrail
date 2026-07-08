import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { getIntegrationRaw } from "@/lib/integrations/repository";
import { testIntegration } from "@/lib/integrations/dispatch";
import type { IntegrationTestResult } from "@/lib/integrations/types";

export const runtime = "nodejs";

// POST /api/integrations/[id]/test — exercise a connector with a synthetic
// event so an operator can confirm it is wired up. Records the attempt as an
// integration event. Admin+ only, org-scoped.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Integration id is required.", 400);

    const pool = getPool();
    const connector = await getIntegrationRaw(pool, ctx.org.id, id);
    if (!connector) return fail("Integration not found.", 404);

    const result = await testIntegration(ctx.org.id, {
      id: connector.id,
      provider: connector.provider,
      name: connector.name,
      config: connector.config,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "integration.test",
      entityType: "integration",
      entityId: id,
      metadata: {
        provider: connector.provider,
        ok: result.ok,
        responseCode: result.responseCode,
      },
    });

    return ok<IntegrationTestResult>(result);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to test integration.", 500);
  }
});

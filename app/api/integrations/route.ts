import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createIntegrationSchema } from "@/lib/integrations/schemas";
import { validateConfig } from "@/lib/integrations/registry";
import {
  countIntegrations,
  listIntegrations,
  insertIntegration,
} from "@/lib/integrations/repository";
import type { Integration } from "@/lib/integrations/types";

export const runtime = "nodejs";

// GET /api/integrations — paginated list of the org's connectors (config
// secrets masked). Admin+ only, org-scoped.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, integrations] = await Promise.all([
      countIntegrations(pool, ctx.org.id),
      listIntegrations(pool, ctx.org.id, limit, offset),
    ]);
    return ok<Integration[]>(integrations, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load integrations.", 500);
  }
});

// POST /api/integrations — install a connector. The provider-specific config is
// validated against the provider's schema before storage. Admin+ only.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => null);
    const parsed = createIntegrationSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const validated = validateConfig(parsed.data.provider, parsed.data.config ?? {});
    if (!validated.ok) {
      return fail(validated.error, 400);
    }

    const pool = getPool();
    const integration = await insertIntegration(pool, {
      orgId: ctx.org.id,
      provider: parsed.data.provider,
      name: parsed.data.name,
      config: validated.config,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "integration.create",
      entityType: "integration",
      entityId: integration.id,
      // Never log config — only non-sensitive provider/name.
      metadata: { provider: integration.provider, name: integration.name },
    });

    return created<Integration>(integration);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create integration.", 500);
  }
});

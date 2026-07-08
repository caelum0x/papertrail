import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { updateIntegrationSchema } from "@/lib/integrations/schemas";
import { validateConfig } from "@/lib/integrations/registry";
import {
  getIntegration,
  getIntegrationRaw,
  updateIntegration,
  deleteIntegration,
} from "@/lib/integrations/repository";
import type { Integration } from "@/lib/integrations/types";

export const runtime = "nodejs";

// GET /api/integrations/[id] — one connector (config secrets masked). Admin+.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Integration id is required.", 400);

    const pool = getPool();
    const integration = await getIntegration(pool, ctx.org.id, id);
    if (!integration) return fail("Integration not found.", 404);

    return ok<Integration>(integration);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load integration.", 500);
  }
});

// PATCH /api/integrations/[id] — update name / status / config. When config is
// provided it is re-validated against the provider's schema. Admin+ only.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Integration id is required.", 400);

    const json = await req.json().catch(() => null);
    const parsed = updateIntegrationSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    // Need the provider to validate config; also confirms the row exists here.
    const existing = await getIntegrationRaw(pool, ctx.org.id, id);
    if (!existing) return fail("Integration not found.", 404);

    let config: Record<string, unknown> | undefined;
    if (parsed.data.config !== undefined) {
      const validated = validateConfig(existing.provider, parsed.data.config);
      if (!validated.ok) return fail(validated.error, 400);
      config = validated.config;
    }

    const updated = await updateIntegration(pool, ctx.org.id, id, {
      name: parsed.data.name,
      status: parsed.data.status,
      config,
    });
    if (!updated) return fail("Integration not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "integration.update",
      entityType: "integration",
      entityId: id,
      metadata: {
        provider: updated.provider,
        name: updated.name,
        status: updated.status,
        configChanged: config !== undefined,
      },
    });

    return ok<Integration>(updated);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update integration.", 500);
  }
});

// DELETE /api/integrations/[id] — remove a connector (events cascade). Admin+.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Integration id is required.", 400);

    const pool = getPool();
    const deleted = await deleteIntegration(pool, ctx.org.id, id);
    if (!deleted) return fail("Integration not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "integration.delete",
      entityType: "integration",
      entityId: id,
      metadata: { provider: deleted.provider, name: deleted.name },
    });

    return ok<Integration>(deleted);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete integration.", 500);
  }
});

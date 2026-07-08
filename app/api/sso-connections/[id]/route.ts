import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { updateSsoConnectionSchema } from "@/lib/sso/schemas";
import { validateSsoConfig } from "@/lib/sso/config";
import {
  getConnection,
  getConnectionRaw,
  updateConnection,
  deleteConnection,
} from "@/lib/sso/repository";
import type { SsoConnection } from "@/lib/sso/types";

export const runtime = "nodejs";

// GET /api/sso-connections/[id] — one connection (config secrets masked). Admin+.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Connection id is required.", 400);

    const pool = getPool();
    const connection = await getConnection(pool, ctx.org.id, id);
    if (!connection) return fail("SSO connection not found.", 404);

    return ok<SsoConnection>(connection);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load SSO connection.", 500);
  }
});

// PATCH /api/sso-connections/[id] — update name/status/domain/config. Enabling
// (status=active) requires a verified domain. Changing config re-validates and
// merges over existing secrets (masked values are preserved). Admin+.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Connection id is required.", 400);

    const json = await req.json().catch(() => null);
    const parsed = updateSsoConnectionSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const pool = getPool();
    const existing = await getConnectionRaw(pool, ctx.org.id, id);
    if (!existing) return fail("SSO connection not found.", 404);

    // Guard: a connection can only be activated once its domain is verified.
    if (parsed.data.status === "active" && !existing.verified) {
      return fail("Verify the domain before activating this connection.", 400);
    }

    let config: Record<string, unknown> | undefined;
    if (parsed.data.config !== undefined) {
      // Merge new values over existing so unchanged secret fields (submitted as a
      // mask, thus absent after validation) are preserved.
      const validated = validateSsoConfig(existing.protocol, parsed.data.config);
      if (!validated.ok) return fail(validated.error, 400);
      config = { ...existing.config, ...validated.config };
    }

    // Changing the claimed domain invalidates any prior verification.
    const domainChanged =
      parsed.data.domain !== undefined && parsed.data.domain !== existing.domain;

    const updated = await updateConnection(pool, ctx.org.id, id, {
      name: parsed.data.name,
      status: parsed.data.status,
      domain: parsed.data.domain,
      config,
      verified: domainChanged ? false : undefined,
    });
    if (!updated) return fail("SSO connection not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "sso_connection.update",
      entityType: "sso_connection",
      entityId: id,
      metadata: {
        name: updated.name,
        status: updated.status,
        domain: updated.domain,
        configChanged: config !== undefined,
        domainReset: domainChanged,
      },
    });

    return ok<SsoConnection>(updated);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to update SSO connection.", 500);
  }
});

// DELETE /api/sso-connections/[id] — remove a connection. Admin+.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "admin");
    const id = params?.id;
    if (!id) return fail("Connection id is required.", 400);

    const pool = getPool();
    const deleted = await deleteConnection(pool, ctx.org.id, id);
    if (!deleted) return fail("SSO connection not found.", 404);

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "sso_connection.delete",
      entityType: "sso_connection",
      entityId: id,
      metadata: { protocol: deleted.protocol, name: deleted.name },
    });

    return ok<SsoConnection>(deleted);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to delete SSO connection.", 500);
  }
});

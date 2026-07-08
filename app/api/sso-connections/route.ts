import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import { createSsoConnectionSchema } from "@/lib/sso/schemas";
import { validateSsoConfig } from "@/lib/sso/config";
import {
  countConnections,
  listConnections,
  insertConnection,
} from "@/lib/sso/repository";
import type { SsoConnection } from "@/lib/sso/types";

export const runtime = "nodejs";

// GET /api/sso-connections — paginated list of the org's SSO connections (config
// secrets masked). Admin+ only, org-scoped.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const pool = getPool();
    const { limit, offset, page } = parsePagination(req);
    const [total, connections] = await Promise.all([
      countConnections(pool, ctx.org.id),
      listConnections(pool, ctx.org.id, limit, offset),
    ]);
    return ok<SsoConnection[]>(connections, { total, page, limit });
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load SSO connections.", 500);
  }
});

// POST /api/sso-connections — create a connection (starts in draft, unverified).
// Provider-specific config is validated against the protocol's fields. Admin+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");
    const json = await req.json().catch(() => null);
    const parsed = createSsoConnectionSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const validated = validateSsoConfig(
      parsed.data.protocol,
      parsed.data.config ?? {}
    );
    if (!validated.ok) {
      return fail(validated.error, 400);
    }

    const pool = getPool();
    const connection = await insertConnection(pool, {
      orgId: ctx.org.id,
      protocol: parsed.data.protocol,
      name: parsed.data.name,
      domain: parsed.data.domain ?? null,
      config: validated.config,
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "sso_connection.create",
      entityType: "sso_connection",
      entityId: connection.id,
      // Never log config — only non-sensitive metadata.
      metadata: {
        protocol: connection.protocol,
        name: connection.name,
        domain: connection.domain,
      },
    });

    return created<SsoConnection>(connection);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to create SSO connection.", 500);
  }
});

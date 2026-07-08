import type { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { writeAudit } from "@/lib/audit";
import {
  createConnectionSchema,
  type ScienceConnectionConfig,
} from "@/lib/science/types";
import { listConnections, createConnection } from "@/lib/science/queries";
import { getWorkbenchStatus } from "@/lib/science/client";

// GET /api/science/connections — org's saved workbench connections plus the
// live env-driven workbench status. Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const connections = await listConnections(getPool(), ctx.org.id);
    const status = getWorkbenchStatus();
    return ok({
      connections,
      workbench: {
        configured: status.configured,
        endpoint: status.endpoint,
        reason: status.reason,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load connections.", 500);
  }
});

// POST /api/science/connections — save a workbench connection config. Managing
// integrations is an admin action. Audited.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "admin");

    const raw = await req.json().catch(() => null);
    const parsed = createConnectionSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid input.", 400);
    }

    const config: ScienceConnectionConfig = {
      endpoint: parsed.data.config?.endpoint ?? null,
      workspaceId: parsed.data.config?.workspaceId ?? null,
      notes: parsed.data.config?.notes ?? null,
    };

    const pool = getPool();
    const connection = await createConnection(pool, {
      orgId: ctx.org.id,
      name: parsed.data.name,
      config,
      status: parsed.data.status ?? "disabled",
    });

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "science.connection.create",
      entityType: "science_connection",
      entityId: connection.id,
      metadata: { name: connection.name, status: connection.status },
    });

    return created(connection);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to save connection.", 500);
  }
});

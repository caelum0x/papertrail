import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import { updateConnectorSchema } from "@/lib/connectors/schemas";
import { configSchemaFor, isProvider } from "@/lib/connectors/catalog";
import {
  deleteConnector,
  getConnector,
  updateConnector,
  type UpdateConnectorArgs,
} from "@/lib/connectors/repo";
import { idSchema, failFromError } from "../_lib";

export const runtime = "nodejs";

// GET /api/connectors/[id] — one connector (config redacted), org-scoped, with
// its most recent sync summary. Any member may read.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const parsed = idSchema.safeParse(params?.id);
    if (!parsed.success) {
      return fail("Invalid connector id.", 400);
    }
    const connector = await getConnector(ctx.org.id, parsed.data);
    if (!connector) {
      return fail("Connector not found.", 404);
    }
    return ok(connector);
  } catch (err: unknown) {
    return failFromError(err, "Failed to load connector.");
  }
});

// PATCH /api/connectors/[id] — update name, config, and/or status. When config
// is provided it's re-validated against the connector's provider schema. Editor+.
export const PATCH = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsedId = idSchema.safeParse(params?.id);
    if (!parsedId.success) {
      return fail("Invalid connector id.", 400);
    }

    const body = await req.json().catch(() => null);
    const parsed = updateConnectorSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid update.", 400);
    }

    const existing = await getConnector(ctx.org.id, parsedId.data);
    if (!existing) {
      return fail("Connector not found.", 404);
    }

    const args: UpdateConnectorArgs = {};
    if (parsed.data.name !== undefined) args.name = parsed.data.name;
    if (parsed.data.status !== undefined) args.status = parsed.data.status;

    if (parsed.data.config !== undefined) {
      if (!isProvider(existing.provider)) {
        return fail("Unknown provider for this connector.", 400);
      }
      const configResult = configSchemaFor(existing.provider).safeParse(
        parsed.data.config
      );
      if (!configResult.success) {
        return fail(
          configResult.error.issues[0]?.message ?? "Invalid configuration.",
          400
        );
      }
      args.config = configResult.data as Record<string, unknown>;
    }

    const updated = await updateConnector(ctx.org.id, parsedId.data, args);
    if (!updated) {
      return fail("Connector not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "connector.update",
      entityType: "connector",
      entityId: updated.id,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return ok(updated);
  } catch (err: unknown) {
    return failFromError(err, "Couldn't update the connector. Please try again.");
  }
});

// DELETE /api/connectors/[id] — remove a connector and its syncs/events
// (cascade). Editor+.
export const DELETE = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");

    const parsed = idSchema.safeParse(params?.id);
    if (!parsed.success) {
      return fail("Invalid connector id.", 400);
    }

    const removed = await deleteConnector(ctx.org.id, parsed.data);
    if (!removed) {
      return fail("Connector not found.", 404);
    }

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "connector.delete",
      entityType: "connector",
      entityId: parsed.data,
    });

    return ok({ id: parsed.data, deleted: true });
  } catch (err: unknown) {
    return failFromError(err, "Couldn't delete the connector. Please try again.");
  }
});

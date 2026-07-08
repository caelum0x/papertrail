import type { NextRequest } from "next/server";
import { withOrg, parsePagination, type Ctx } from "@/lib/api/handler";
import { ok, created, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requireRole } from "@/lib/authz/rbac";
import {
  createConnectorSchema,
  listConnectorsQuerySchema,
} from "@/lib/connectors/schemas";
import { configSchemaFor } from "@/lib/connectors/catalog";
import {
  createConnector,
  listConnectors,
  type ConnectorFilters,
} from "@/lib/connectors/repo";
import { failFromError } from "./_lib";

export const runtime = "nodejs";

// GET /api/connectors — paginated, org-scoped list of installed connectors,
// newest-first, with each connector's most recent sync summary. Optional
// ?provider and ?status filters. Any member may read.
export const GET = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const { limit, offset, page } = parsePagination(req);
    const url = new URL(req.url);

    const parsed = listConnectorsQuerySchema.safeParse({
      provider: url.searchParams.get("provider") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
    });
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid filters.", 400);
    }

    const filters: ConnectorFilters = {
      provider: parsed.data.provider,
      status: parsed.data.status,
    };

    const { items, total } = await listConnectors(
      ctx.org.id,
      filters,
      limit,
      offset
    );
    return ok(items, { total, page, limit });
  } catch (err: unknown) {
    return failFromError(err, "Failed to load connectors.");
  }
});

// POST /api/connectors — install a connector. Validates the base shape, then
// validates the provider-specific `config` against the catalog schema for that
// provider. Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "editor");

    const body = await req.json().catch(() => null);
    const parsed = createConnectorSchema.safeParse(body);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid connector.", 400);
    }

    // Validate the provider-specific config shape at the boundary.
    const configResult = configSchemaFor(parsed.data.provider).safeParse(
      parsed.data.config
    );
    if (!configResult.success) {
      return fail(
        configResult.error.issues[0]?.message ?? "Invalid connector configuration.",
        400
      );
    }

    const connector = await createConnector({
      orgId: ctx.org.id,
      provider: parsed.data.provider,
      name: parsed.data.name,
      config: configResult.data as Record<string, unknown>,
    });

    await writeAudit(getPool(), {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "connector.create",
      entityType: "connector",
      entityId: connector.id,
      metadata: { provider: connector.provider, name: connector.name },
    });

    return created(connector);
  } catch (err: unknown) {
    return failFromError(err, "Couldn't create the connector. Please try again.");
  }
});

import type { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { CATALOG_LIST } from "@/lib/connectors/catalog";
import { failFromError } from "../_lib";

export const runtime = "nodejs";

// GET /api/connectors/catalog — the provider catalog (display metadata,
// capabilities, and config field descriptors) used to render the catalog grid
// and per-provider config forms. Any member may read. Zod schemas are stripped
// from the response (they aren't serializable); the field descriptors carry the
// shape the client needs.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const entries = CATALOG_LIST.map((e) => ({
      provider: e.provider,
      name: e.name,
      category: e.category,
      description: e.description,
      fields: e.fields,
      capabilities: e.capabilities,
    }));
    return ok(entries);
  } catch (err: unknown) {
    return failFromError(err, "Failed to load connector catalog.");
  }
});

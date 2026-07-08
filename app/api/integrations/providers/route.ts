import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { listProviders, type ProviderCatalogEntry } from "@/lib/integrations/registry";

export const runtime = "nodejs";

// GET /api/integrations/providers — the static catalog of connector providers
// (id, name, description, config fields) so the console can render the "add an
// integration" grid. Any authenticated org member may read the catalog.
export const GET = withOrg(async (_req: NextRequest, _ctx: Ctx) => {
  try {
    return ok<ProviderCatalogEntry[]>(listProviders());
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load provider catalog.", 500);
  }
});

import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { getPool } from "@/lib/db";
import { listSources, getAccessLog } from "@/lib/governance/dataSources";
import type {
  DataSource,
  SourceAccess,
} from "@/lib/governance/dataSources.schemas";

export const runtime = "nodejs";

interface DataSourceRegistryResponse {
  sources: DataSource[];
  recentAccesses: SourceAccess[];
}

// GET /api/governance/data-sources — the provenance registry any member of the
// org may read. Two parts:
//   * sources         — PUBLIC reference facts (database, version, license, url)
//                       for every open data source PaperTrail integrates.
//   * recentAccesses  — this ORG's recent source-access log, newest first. The
//                       access log is org-scoped; org_id comes from ctx, never
//                       the client, so a tenant only ever sees its own trail.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    const pool = getPool();
    const [sources, recentAccesses] = await Promise.all([
      listSources(pool),
      getAccessLog(pool, ctx.org.id),
    ]);
    return ok<DataSourceRegistryResponse>({ sources, recentAccesses });
  } catch {
    return fail("Couldn't load the data-source registry. Please try again.", 500);
  }
});

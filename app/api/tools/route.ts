import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { listTools } from "@/lib/tools/registry";
import { listRegistrations } from "@/lib/tools/repository";
import type { ToolDescriptor } from "@/lib/tools/types";

export const runtime = "nodejs";

// GET /api/tools — the catalog of callable tools: PaperTrail's built-in tools
// plus any tools this org has registered. Org-scoped; any member (viewer+) may
// read the catalog. Registered tools are appended after the built-ins.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const pool = getPool();
    const builtins = listTools();
    const registered = await listRegistrations(pool, ctx.org.id);

    const registeredDescriptors: ToolDescriptor[] = registered.map((r) => ({
      name: r.name,
      description: r.description,
      source: "registered",
      enabled: r.enabled,
      inputSchema: r.inputSchema,
    }));

    return ok<ToolDescriptor[]>([...builtins, ...registeredDescriptors]);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load tools.", 500);
  }
});

import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { listTools } from "@/lib/tools/registry";
import { listRegistrations } from "@/lib/tools/repository";

export const runtime = "nodejs";

// An MCP-style tool entry: name, description, and a JSON-Schema input spec — the
// shape an MCP client expects under a server's "tools" list.
interface ManifestTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpManifest {
  schemaVersion: string;
  name: string;
  description: string;
  tools: ManifestTool[];
}

// GET /api/mcp/manifest — an MCP-style JSON manifest describing every tool this
// org can call (built-ins + enabled registered tools). Org-scoped; any member
// (viewer+) may read it. This is the document an MCP client would consume to learn
// what PaperTrail capabilities are available as callable tools.
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx) => {
  try {
    requireRole(ctx, "viewer");
    const pool = getPool();
    const builtins = listTools();
    const registered = await listRegistrations(pool, ctx.org.id);

    const tools: ManifestTool[] = [
      ...builtins.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      ...registered
        .filter((r) => r.enabled)
        .map((r) => ({
          name: r.name,
          description: r.description,
          inputSchema: r.inputSchema,
        })),
    ];

    const manifest: McpManifest = {
      schemaVersion: "2024-11-05",
      name: `papertrail-${ctx.org.slug}`,
      description:
        "PaperTrail provenance & verification tools: verify clinical-trial efficacy claims against their primary sources, check claims against registered ClinicalTrials.gov results, extract structured findings, and recompute biostatistics.",
      tools,
    };

    return ok<McpManifest>(manifest);
  } catch (err) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to build MCP manifest.", 500);
  }
});

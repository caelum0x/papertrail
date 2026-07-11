import { NextRequest } from "next/server";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { type KgPool } from "@/lib/kg/repository";
import { validateAndImportKg, KgImportRequestSchema } from "@/lib/kg/byoKg";

// Public POST endpoint for BRING-YOUR-OWN-KG IMPORT.
//
// An org member (editor+) uploads their own knowledge graph — a list of nodes and a list
// of typed edges — and we import it into the shared evidence graph (kg_nodes / kg_edges,
// migration 0052). Every edge's predicate is validated against the Biolink slot
// domain/range via lib/kg/biolink.ts (the TypeScript port of the vendored BioCypher
// engine — see backend/engines/biocypher/PAPERTRAIL.md): an ill-typed edge (e.g. a
// `treats` whose subject is a disease) is REJECTED with a reason, never silently coerced
// into the graph. The run is recorded as a kg_import_batches audit row.
//
// There is NO LLM anywhere in the validation: the accept/reject decision is deterministic
// Biolink typing. We prefer an honest rejection over a forced, poisoned edge. No node/edge
// text is logged — only the org id and counts.
export const runtime = "nodejs";

function requirePool(): KgPool | null {
  try {
    return getPool() as unknown as KgPool;
  } catch {
    return null;
  }
}

export const POST = withOrg(async (req: NextRequest, ctx: Ctx) => {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("kg.import.rate_limited", { orgId: ctx.org.id });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  // Importing writes to the shared graph — require an editor (throws a 403-mapped error
  // that withOrg maps to a fail() response otherwise).
  requireRole(ctx, "editor");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("Request body must be valid JSON.", 400);
  }

  const parsed = KgImportRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return fail(
      `Invalid KG import request — ${where}${issue?.message ?? "provide nodes[] and edges[]."}`,
      400
    );
  }

  const pool = requirePool();
  if (!pool) {
    logEvent("kg.import.db_unconfigured", { orgId: ctx.org.id });
    return fail("The knowledge graph is temporarily unavailable.", 503);
  }

  try {
    const result = await validateAndImportKg(
      pool,
      ctx.org.id,
      parsed.data,
      ctx.user.id
    );

    logEvent("kg.import.success", {
      orgId: ctx.org.id,
      latencyMs: Date.now() - start,
      importedNodes: result.imported.nodes,
      importedEdges: result.imported.edges,
      rejectedCount: result.rejected.length,
    });

    return ok(result);
  } catch (err) {
    logEvent("kg.import.error", {
      orgId: ctx.org.id,
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/kg/import] failed:", err);
    return fail(
      "Something went wrong while importing the knowledge graph. This has been logged — please check your inputs and try again.",
      500
    );
  }
});

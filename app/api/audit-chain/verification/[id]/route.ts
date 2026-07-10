import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { buildChainOfCustody, type ChainOfCustody } from "@/lib/provenance/chainOfCustody";

export const runtime = "nodejs";

// GET /api/audit-chain/verification/[id] — reconstruct the EXACT chain-of-custody
// state for one stored verification at export time: every grounded span with its
// { source_id, doi/pmid, source_version, snapshot_date, verification_id,
// chain_of_custody_hash } tuple, plus a deterministic aggregate hash. Viewer+.
//
// No LLM, no scoring — pure deterministic assembly from the cached source + the
// snapshot version ledger. Spans that no longer ground against the current source
// text are dropped and counted (honest "we can't point to this anymore").
const idSchema = z.string().uuid();

function rbacStatus(err: unknown): number | null {
  if (
    err instanceof Error &&
    typeof (err as unknown as { status?: unknown }).status === "number"
  ) {
    return (err as unknown as { status: number }).status;
  }
  return null;
}

export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");

    const parsed = idSchema.safeParse(params?.id);
    if (!parsed.success) {
      return fail("Invalid verification id.", 400);
    }

    const custody = await buildChainOfCustody(getPool(), parsed.data);
    if (!custody) {
      return fail("Verification not found.", 404);
    }

    return ok<ChainOfCustody>(custody);
  } catch (err: unknown) {
    const status = rbacStatus(err);
    if (status !== null) {
      return fail((err as Error).message, status);
    }
    return fail("Couldn't reconstruct the chain of custody. Please try again.", 500);
  }
});

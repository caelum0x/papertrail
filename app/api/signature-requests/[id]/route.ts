import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { getRequestDetail } from "@/lib/signatures/repository";
import type { SignatureRequestDetail } from "@/lib/signatures/types";

export const runtime = "nodejs";

// GET /api/signature-requests/[id] — a request with its ordered signer trail and
// certificate (if issued). Any member (viewer+).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id) return fail("Request id is required.", 400);

    const detail = await getRequestDetail(getPool(), ctx.org.id, id);
    if (!detail) return fail("Signature request not found.", 404);
    return ok<SignatureRequestDetail>(detail);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load signature request.", 500);
  }
});

import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { getRequestById, getCertificate } from "@/lib/signatures/repository";
import type { SignatureCertificate } from "@/lib/signatures/types";

export const runtime = "nodejs";

// GET /api/signature-requests/[id]/certificate — the completion certificate for
// a request. 404 if the request doesn't exist or hasn't been completed yet.
// Any member (viewer+) may read a certificate (it is the evidence of signing).
export const GET = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "viewer");
    const id = params?.id;
    if (!id) return fail("Request id is required.", 400);

    const pool = getPool();
    const request = await getRequestById(pool, ctx.org.id, id);
    if (!request) return fail("Signature request not found.", 404);

    const cert = await getCertificate(pool, ctx.org.id, id);
    if (!cert) {
      return fail("No certificate has been issued for this request yet.", 404);
    }
    return ok<SignatureCertificate>(cert);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to load certificate.", 500);
  }
});

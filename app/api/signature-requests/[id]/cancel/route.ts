import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { cancelRequest } from "@/lib/signatures/repository";
import type { SignatureRequestDetail } from "@/lib/signatures/types";

export const runtime = "nodejs";

// POST /api/signature-requests/[id]/cancel — abandon a draft/pending request.
// Editor+.
export const POST = withOrg(async (_req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id) return fail("Request id is required.", 400);

    const pool = getPool();
    const result = await cancelRequest(pool, {
      orgId: ctx.org.id,
      requestId: id,
    });

    if (!result.ok) {
      if (result.reason === "not_found") {
        return fail("Signature request not found.", 404);
      }
      return fail("A completed or cancelled request cannot be cancelled.", 409);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "signature_request.cancelled",
      entityType: "signature_request",
      entityId: id,
      metadata: { title: result.detail.request.title },
    });

    return ok<SignatureRequestDetail>(result.detail);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to cancel request.", 500);
  }
});

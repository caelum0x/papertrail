import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { addSignersSchema } from "@/lib/signatures/schemas";
import { addSigners } from "@/lib/signatures/repository";
import type { SignatureRequestDetail } from "@/lib/signatures/types";

export const runtime = "nodejs";

// POST /api/signature-requests/[id]/signers — append signers (in order) to a
// draft/pending request. Editor+.
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id) return fail("Request id is required.", 400);

    const json = await req.json().catch(() => null);
    const parsed = addSignersSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const result = await addSigners(pool, {
      orgId: ctx.org.id,
      requestId: id,
      signerUserIds: parsed.data.signerUserIds,
    });

    if (!result.ok) {
      if (result.reason === "not_found") {
        return fail("Signature request not found.", 404);
      }
      if (result.reason === "duplicate") {
        return fail("One or more signers are already on this request.", 409);
      }
      return fail("Signers can only be added to open requests.", 409);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "signature_request.signers_added",
      entityType: "signature_request",
      entityId: id,
      metadata: {
        added: parsed.data.signerUserIds.length,
        signerCount: result.detail.signers.length,
      },
    });

    return ok<SignatureRequestDetail>(result.detail);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to add signers.", 500);
  }
});

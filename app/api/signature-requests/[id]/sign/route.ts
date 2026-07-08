import { NextRequest } from "next/server";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { signSchema } from "@/lib/signatures/schemas";
import { sign } from "@/lib/signatures/repository";
import type { SignatureRequestDetail } from "@/lib/signatures/types";

export const runtime = "nodejs";

// POST /api/signature-requests/[id]/sign — the current signer signs. Requires an
// MFA-meaning string asserting how the signer re-authenticated. Strict
// turn-taking is enforced by the repository. Editor+ (only assigned signers can
// actually sign, but the capability floor is editor).
export const POST = withOrg(async (req: NextRequest, ctx: Ctx, params) => {
  try {
    requireRole(ctx, "editor");
    const id = params?.id;
    if (!id) return fail("Request id is required.", 400);

    const json = await req.json().catch(() => null);
    const parsed = signSchema.safeParse(json);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Invalid request body.", 400);
    }

    const pool = getPool();
    const result = await sign(pool, {
      orgId: ctx.org.id,
      requestId: id,
      userId: ctx.user.id,
    });

    if (!result.ok) {
      if (result.reason === "not_found") {
        return fail("Signature request not found.", 404);
      }
      if (result.reason === "not_pending") {
        return fail("This request is not awaiting signatures.", 409);
      }
      if (result.reason === "no_signers") {
        return fail("This request has no outstanding signers.", 409);
      }
      return fail("It is not your turn to sign this request.", 403);
    }

    await writeAudit(pool, {
      orgId: ctx.org.id,
      userId: ctx.user.id,
      action: "signature_request.signed",
      entityType: "signature_request",
      entityId: id,
      metadata: {
        mfaMethod: parsed.data.mfaMethod,
        completed: result.completed,
        certHash: result.detail.certificate?.certHash ?? null,
      },
    });

    return ok<SignatureRequestDetail>(result.detail);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return fail(err.message, (err as { status: number }).status);
    }
    return fail("Failed to sign request.", 500);
  }
});

import { NextRequest } from "next/server";
import { z } from "zod";
import { withOrg, type Ctx } from "@/lib/api/handler";
import { ok, fail } from "@/lib/api/response";
import { requireRole } from "@/lib/authz/rbac";
import { getClaim, listClaimVerifications } from "@/lib/claims/repository";

export const runtime = "nodejs";

const idSchema = z.string().uuid();

// GET /api/claims/[id]/verifications — the verification history for a claim,
// newest first. Org-scoped: we confirm the claim belongs to the org before
// returning its linked verification rows.
export const GET = withOrg(
  async (_req: NextRequest, ctx: Ctx, params) => {
    try {
      requireRole(ctx, "viewer");

      const parsedId = idSchema.safeParse(params?.id);
      if (!parsedId.success) return fail("Invalid claim id.", 400);

      const claim = await getClaim(ctx.org.id, parsedId.data);
      if (!claim) return fail("Claim not found.", 404);

      const items = await listClaimVerifications(claim.id);
      return ok(items, { total: items.length });
    } catch (err) {
      if (err instanceof Error && "status" in err) throw err;
      return fail("Couldn't load verification history. Please try again.", 500);
    }
  }
);

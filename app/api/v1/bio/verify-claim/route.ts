import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { withApiKey, type ApiCtx } from "@/lib/apiv1/gateway";
import { verifyBiomedicalClaim } from "@/lib/bio/verifyBiomedicalClaim";

// POST /api/v1/bio/verify-claim
//
// Versioned enterprise API over the biomedical claim verifier. Authenticated by
// an org API key (Bearer) with per-plan quota enforced by the gateway. Wraps the
// existing verifyBiomedicalClaim engine — this route adds NO domain logic; it
// validates input, delegates, and returns a stable v1 envelope.

export const runtime = "nodejs";

const API_VERSION = "v1" as const;

// Local boundary schema — the engine accepts { claim }, but the HTTP boundary
// still validates shape/length before delegating (fail fast, never trust input).
const verifyClaimSchema = z.object({
  claim: z.string().trim().min(10).max(2000),
});

export const POST = withApiKey(
  async (req: NextRequest, ctx: ApiCtx): Promise<Response> => {
    const json = await req.json().catch(() => null);
    const parsed = verifyClaimSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues[0]?.message ?? "Invalid request body.",
        400
      );
    }

    try {
      const verification = await verifyBiomedicalClaim({
        claim: parsed.data.claim,
      });
      return ok({
        version: API_VERSION,
        orgId: ctx.orgId,
        verification,
      });
    } catch {
      return fail("Biomedical claim verification failed. Please retry.", 502);
    }
  },
  { quotaKind: "verification", routeLabel: "/api/v1/bio/verify-claim" }
);

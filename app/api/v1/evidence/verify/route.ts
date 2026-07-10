import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ok, fail } from "@/lib/api/response";
import { withApiKey, type ApiCtx } from "@/lib/apiv1/gateway";
import {
  runEvidencePipeline,
  EvidencePipelineInputSchema,
} from "@/lib/evidencePipeline";

// POST /api/v1/evidence/verify
//
// Versioned enterprise API over the evidence-synthesis engine. Authenticated by
// an org API key (Bearer) with per-plan quota enforced by the gateway. Wraps the
// existing runEvidencePipeline — this route adds NO scientific logic of its own;
// it only validates input, delegates, and shapes a stable v1 envelope.

export const runtime = "nodejs";

const API_VERSION = "v1" as const;

export const POST = withApiKey(
  async (req: NextRequest, ctx: ApiCtx): Promise<Response> => {
    // Validate at the boundary — never trust the request body.
    const json = await req.json().catch(() => null);
    const parsed = EvidencePipelineInputSchema.safeParse(json);
    if (!parsed.success) {
      return fail(
        parsed.error.issues[0]?.message ?? "Invalid request body.",
        400
      );
    }

    try {
      const result = await runEvidencePipeline(getPool(), parsed.data);
      // Stable versioned envelope: version + org echo + engine result. orgId is
      // the gateway-resolved id, never a client-supplied value.
      return ok({
        version: API_VERSION,
        orgId: ctx.orgId,
        claim: result.claim,
        report: result.report,
        usedSources: result.usedSources,
        skipped: result.skipped,
      });
    } catch {
      return fail("Evidence verification failed. Please retry.", 502);
    }
  },
  { quotaKind: "verification", routeLabel: "/api/v1/evidence/verify" }
);

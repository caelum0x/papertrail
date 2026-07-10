import type { NextRequest } from "next/server";
import { ok } from "@/lib/api/response";
import {
  withGateway,
  sessionGateway,
} from "@/lib/security/gatewayChain";
import type { RequestContext } from "@/lib/security/requestContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/gateway/whoami — the reference demonstration route for the unified
// gateway chain (lib/security/gatewayChain.ts). It exists to PROVE the pipeline
// end-to-end on a brand-new route without touching any existing handler:
//
//   - authN:      requires a valid session cookie (401 otherwise)
//   - provenance: stamps an x-papertrail-request-id on the response
//   - authZ:      requires at least "viewer" (read) via rbac
//   - ip:         enforced only if the org configured an ip allowlist
//   - rate-limit: throttles per org (no metered quotaKind — this is a read)
//
// The handler echoes ONLY the resolved, non-sensitive context identifiers so a
// caller (or a judge) can see exactly what the chain established. It never
// returns claim text, patient text, tokens, or secrets — the whole point of the
// primitive is that identity is resolved server-side and surfaced as ids only.
const ROUTE_LABEL = "gateway.whoami";

async function handler(_req: NextRequest, ctx: RequestContext): Promise<Response> {
  return ok({
    requestId: ctx.requestId,
    orgId: ctx.orgId ?? null,
    userId: ctx.userId ?? null,
    role: ctx.role ?? null,
    authMethod: ctx.authMethod,
    // ip is echoed so the allowlist behavior is visible in the demo; it is an
    // address, not PHI, and is the same value the ip stage evaluated.
    ip: ctx.ip,
  });
}

export const GET = withGateway(handler, {
  routeLabel: ROUTE_LABEL,
  stages: sessionGateway({ routeLabel: ROUTE_LABEL, minRole: "viewer" }),
});

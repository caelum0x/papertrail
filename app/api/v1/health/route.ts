import { ok } from "@/lib/api/response";

// GET /api/v1/health
//
// Public, unauthenticated status probe for the enterprise API surface. Returns a
// stable versioned envelope so integrators can assert reachability and API
// version without holding a key. Deliberately leaks nothing: no DB state, no
// counts, no org data — just a static liveness signal.

export const runtime = "nodejs";

const API_VERSION = "v1" as const;

export function GET(): Response {
  return ok({
    status: "ok",
    version: API_VERSION,
    service: "papertrail-enterprise-api",
  });
}

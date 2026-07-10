import type { NextRequest } from "next/server";
import type { Role } from "@/lib/authz/rbac";

// ---------------------------------------------------------------------------
// RequestContext — the single, typed object that flows through the unified
// gateway chain (see gatewayChain.ts). Each stage may READ from it and each
// stage that authenticates the caller may return an ENRICHED copy of it. It is
// treated as immutable: stages never mutate a context in place, they return a
// new one (see withContext), so a later stage can never silently corrupt what
// an earlier stage established.
//
// Deliberately minimal and PHI-free: it carries only identifiers and coarse
// attributes (request id, org id, role, client ip, auth method). It NEVER
// carries claim text, patient text, secrets, or raw tokens — those must not
// travel through logs or telemetry.
// ---------------------------------------------------------------------------

// How the caller proved who they are. "anonymous" is the pre-authN default;
// a route that opts into an authN stage will have one of the others by the time
// its handler runs (or the request was already denied).
export type AuthMethod = "anonymous" | "session" | "api_key" | "sso";

export interface RequestContext {
  // A per-request provenance id, stamped once and echoed on the response so a
  // client error report can be correlated to server telemetry. Opaque, random.
  readonly requestId: string;
  // The resolved tenant. Present only after an authN stage that resolves an org
  // (session/api-key/sso). Absent for anonymous or org-less requests.
  readonly orgId?: string;
  // The acting user id, when the auth method has one (session/sso). API-key
  // auth is org-scoped, not user-scoped, so this is absent for that method.
  readonly userId?: string;
  // The caller's role within `orgId`, when membership was resolved. Drives authZ.
  readonly role?: Role;
  // The best-effort client IP, derived from proxy headers at the edge. Used by
  // the IP allow-list stage and recorded (as an id-like value) in telemetry.
  readonly ip: string;
  // How the caller authenticated. Starts "anonymous"; set by the authN stage.
  readonly authMethod: AuthMethod;
}

// Header name for the provenance/request-id stamp echoed on every response.
export const REQUEST_ID_HEADER = "x-papertrail-request-id";

// Generates a random, opaque request id. Uses the platform Web Crypto UUID,
// which is available in the Next.js runtimes this app targets.
export function newRequestId(): string {
  return crypto.randomUUID();
}

// Extracts a best-effort client IP from standard proxy headers, matching how
// Vercel/Neon-fronted deployments surface the originating address. Falls back to
// a stable sentinel when no header is present (e.g. local dev), so downstream
// stages always have a non-empty string to reason about.
export function clientIpFromRequest(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    // The left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const real = req.headers.get("x-real-ip");
  if (real && real.trim().length > 0) {
    return real.trim();
  }
  return "unknown";
}

// Builds the initial, anonymous context for a request. Every chain starts here;
// authN stages return enriched copies via withContext.
export function initialContext(req: NextRequest): RequestContext {
  return {
    requestId: newRequestId(),
    ip: clientIpFromRequest(req),
    authMethod: "anonymous",
  };
}

// Returns a NEW context with the given fields overlaid. Never mutates the input
// — this is the only sanctioned way a stage enriches the context, keeping the
// pipeline free of hidden side effects (per the immutability convention).
export function withContext(
  ctx: RequestContext,
  patch: Partial<Omit<RequestContext, "requestId">>
): RequestContext {
  return { ...ctx, ...patch };
}

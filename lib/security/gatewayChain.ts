import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { fail } from "@/lib/api/response";
import { getSessionUserId } from "@/lib/auth/session";
import { hashApiKey } from "@/lib/admin-audit/apiKeys";
import { hasRoleAtLeast, type Role } from "@/lib/authz/rbac";
import { checkRateLimit, type RateLimitOptions } from "@/lib/rateLimit";
import { checkQuota } from "@/lib/billing/usage";
import { recordApiRequest, recordRateLimitEvent } from "@/lib/apiusage/record";
import { logEvent } from "@/lib/logger";
import {
  initialContext,
  withContext,
  REQUEST_ID_HEADER,
  type RequestContext,
} from "@/lib/security/requestContext";

// ---------------------------------------------------------------------------
// Unified, composable gateway chain.
//
// This is the NEW front-door primitive for Phase 3 enterprise hardening. It
// consolidates the scattered per-route checks (auth, role, ip, rate-limit,
// quota) into ONE ordered pipeline a route opts into stage-by-stage. It does
// NOT replace middleware.ts or lib/apiv1/gateway.ts — it is additive, imports
// the existing resolvers (session/api-key crypto, rbac, rate-limit, quota) and
// never reimplements them. Existing routes migrate onto it in waves (see
// docs/gateway-rollout.md); no existing handler is edited by shipping this.
//
// Design: each stage is a small, pure-ish PREDICATE `(req, ctx) => Decision`.
// A Decision either ALLOWS (optionally handing back an enriched context) or
// DENIES with a machine reason + HTTP status + safe client message. The chain
// runs the opted-in stages IN ORDER and short-circuits on the first deny, so a
// route composes exactly the posture it needs:
//
//   (1) ipAllowlist  — deny callers outside the org's configured CIDR ranges
//   (2) authN        — resolve caller identity (session | api-key | sso)
//   (3) authZ        — enforce a minimum role via rbac
//   (4) provenance   — stamp/confirm the per-request id (always on)
//   (5) rateLimit + quota — throttle + meter against the org's plan
//
// Every stage reason is telemetry-safe: only ids/counts/reasons are logged,
// never claim text, patient text, secrets, or raw tokens.
// ---------------------------------------------------------------------------

// The outcome of a single stage. `allow` may carry an enriched context that the
// remaining stages (and the handler) will see. `deny` carries the client-facing
// status/message plus a stable machine `reason` for telemetry.
export type StageDecision =
  | { allow: true; ctx?: RequestContext }
  | { allow: false; status: number; message: string; reason: string };

// A gateway stage: given the request and the current context, decide. Stages
// must be side-effect-light — the only sanctioned mutation is returning an
// enriched context (never mutating the passed one).
export type GatewayStage = (
  req: NextRequest,
  ctx: RequestContext
) => Promise<StageDecision>;

// The handler a gateway-wrapped route provides. It receives the fully-resolved,
// immutable context (request id + whatever identity the opted-in stages
// established) so it never has to re-derive org/role/ip itself.
export type GatewayHandler = (
  req: NextRequest,
  ctx: RequestContext
) => Promise<Response>;

// Small convenience constructors so stages read declaratively.
export function allow(ctx?: RequestContext): StageDecision {
  return ctx ? { allow: true, ctx } : { allow: true };
}

export function deny(
  status: number,
  message: string,
  reason: string
): StageDecision {
  return { allow: false, status, message, reason };
}

// ---------------------------------------------------------------------------
// Stage 1 — IP allow-list.
//
// Reuses the governance `ip_allowlist` table (per-org CIDR ranges). Policy:
// when an org has configured ZERO ranges the stage is a NO-OP (fail-open by
// absence of config — an org that hasn't opted in is not locked out). When it
// HAS ranges, the caller's ip must fall inside one of them or the request is
// denied. Requires an org in context, so it is only meaningful AFTER authN;
// callers place it accordingly (see requireApiKey/requireSession presets).
// ---------------------------------------------------------------------------
export function ipAllowlistStage(): GatewayStage {
  return async (_req, ctx) => {
    // No org resolved yet (or an org-less request): nothing org-scoped to check.
    if (!ctx.orgId) {
      return allow();
    }
    let cidrs: string[];
    try {
      const { rows } = await getPool().query<{ cidr: string }>(
        `select cidr from ip_allowlist where org_id = $1`,
        [ctx.orgId]
      );
      cidrs = rows.map((r) => r.cidr);
    } catch {
      // Fail closed on infrastructure error: if we cannot evaluate the
      // allowlist we must not silently admit a possibly-out-of-range caller.
      return deny(500, "Could not evaluate access controls.", "ip_lookup_error");
    }
    if (cidrs.length === 0) {
      return allow(); // org has not configured an allowlist → not enforced
    }
    const permitted = cidrs.some((cidr) => ipInCidr(ctx.ip, cidr));
    if (!permitted) {
      return deny(403, "Access denied from this network.", "ip_not_allowed");
    }
    return allow();
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — authN. Three interchangeable resolvers, each returning an enriched
// context on success. A route picks the ONE that matches its clients; it never
// reimplements crypto — it delegates to the existing session and api-key layers.
// ---------------------------------------------------------------------------

// Session (browser) auth: resolves the user from the httpOnly session cookie,
// then their membership (org + role) so authZ can run. A route that needs a
// specific org supplies `orgId`; otherwise the user's first membership is used.
export function sessionAuthStage(opts?: { orgId?: string }): GatewayStage {
  return async (_req, ctx) => {
    const userId = await getSessionUserId();
    if (!userId) {
      return deny(401, "Not authenticated.", "no_session");
    }
    let membership: { orgId: string; role: Role } | null;
    try {
      membership = await resolveMembership(userId, opts?.orgId);
    } catch {
      return deny(500, "Could not verify your session.", "membership_error");
    }
    if (!membership) {
      return deny(403, "You do not have access to this organization.", "no_membership");
    }
    return allow(
      withContext(ctx, {
        userId,
        orgId: membership.orgId,
        role: membership.role,
        authMethod: "session",
      })
    );
  };
}

// API-key auth: resolves the org SERVER-SIDE from a hashed bearer key, exactly
// like lib/apiv1/gateway.ts. API keys are org-scoped machine credentials, so
// the context gets an org but no user; the role defaults to the configured
// machine role (owner-equivalent for automation is too broad, so we grant the
// key's stored role, falling back to "editor" — enough to write, not to admin).
export function apiKeyAuthStage(): GatewayStage {
  return async (req, ctx) => {
    const raw = extractBearer(req);
    if (!raw) {
      return deny(401, "Missing or malformed API key.", "no_api_key");
    }
    let resolved: { orgId: string; role: Role } | null;
    try {
      resolved = await resolveApiKey(raw);
    } catch {
      return deny(500, "Could not verify API key.", "api_key_error");
    }
    if (!resolved) {
      return deny(401, "Invalid or revoked API key.", "bad_api_key");
    }
    return allow(
      withContext(ctx, {
        orgId: resolved.orgId,
        role: resolved.role,
        authMethod: "api_key",
      })
    );
  };
}

// SSO auth: enterprise IdP-federated sessions land in the SAME httpOnly session
// cookie once the SSO callback completes, so identity resolution is identical
// to sessionAuthStage — we delegate to it and only relabel the auth method so
// telemetry can distinguish federated from password logins. This deliberately
// does NOT reimplement any SSO/SAML crypto; that lives in lib/sso and runs at
// the callback, before the gateway ever sees the request.
export function ssoAuthStage(opts?: { orgId?: string }): GatewayStage {
  const inner = sessionAuthStage(opts);
  return async (req, ctx) => {
    const decision = await inner(req, ctx);
    if (decision.allow && decision.ctx) {
      return allow(withContext(decision.ctx, { authMethod: "sso" }));
    }
    return decision;
  };
}

// ---------------------------------------------------------------------------
// Stage 3 — authZ. Enforces a minimum role using rbac's ordering. Requires a
// role in context (i.e. an authN stage ran first); if none is present the
// request is denied rather than admitted, so mis-ordered chains fail closed.
// ---------------------------------------------------------------------------
export function requireRoleStage(minRole: Role): GatewayStage {
  return async (_req, ctx) => {
    if (!ctx.role) {
      return deny(403, "Insufficient permissions.", "no_role");
    }
    if (!hasRoleAtLeast(ctx.role, minRole)) {
      return deny(403, `Requires ${minRole} role or higher.`, "role_too_low");
    }
    return allow();
  };
}

// ---------------------------------------------------------------------------
// Stage 4 — provenance. The request id is stamped at context creation; this
// stage is the explicit, always-on marker that provenance is part of the chain
// and a hook point for future enrichment (e.g. trace propagation). It never
// denies.
// ---------------------------------------------------------------------------
export function provenanceStage(): GatewayStage {
  return async () => allow();
}

// ---------------------------------------------------------------------------
// Stage 5 — rate-limit + quota. Rate-limit is a fast in-memory guard keyed by
// org (or ip when anonymous); quota is the per-plan billing check. Quota only
// runs when an org and a metered `quotaKind` are both known. A rate-limit or
// quota rejection records a telemetry event (best-effort) so operators see it.
// ---------------------------------------------------------------------------
export interface RateLimitStageOptions {
  // Stable label recorded in api_requests / rate_limit_events for this route.
  routeLabel: string;
  // Optional per-route throttle overrides (else the env defaults apply).
  rateLimit?: RateLimitOptions;
  // When set, also enforce the org's plan quota for this metered kind.
  quotaKind?: string;
}

export function rateLimitStage(opts: RateLimitStageOptions): GatewayStage {
  return async (_req, ctx) => {
    // Key by org when known (fair per-tenant limits); fall back to ip so
    // anonymous/pre-authN callers are still throttled.
    const key = `gw:${opts.routeLabel}:${ctx.orgId ?? ctx.ip}`;
    const rl = checkRateLimit(key, opts.rateLimit);
    if (!rl.allowed) {
      if (ctx.orgId) {
        await recordRateLimitEvent({ orgId: ctx.orgId, route: opts.routeLabel });
      }
      return deny(429, "Too many requests. Please slow down.", "rate_limited");
    }

    if (opts.quotaKind && ctx.orgId) {
      let allowedByQuota: boolean;
      try {
        const decision = await checkQuota(ctx.orgId, opts.quotaKind, 1);
        allowedByQuota = decision.allowed;
      } catch {
        return deny(500, "Could not evaluate account quota.", "quota_error");
      }
      if (!allowedByQuota) {
        await recordRateLimitEvent({ orgId: ctx.orgId, route: opts.routeLabel });
        return deny(
          429,
          "Plan quota exceeded for this billing period.",
          "quota_exceeded"
        );
      }
    }
    return allow();
  };
}

// ---------------------------------------------------------------------------
// withGateway — compose an ordered list of stages around a handler.
//
// Runs the stages in the order given, threading the (immutable) context: each
// stage sees the context enriched by the prior stages. The first deny short-
// circuits with the standard { success:false, error } envelope. On allow, the
// handler runs and the request-id header is stamped on the response. Handler
// throws become a 500 with the same envelope so no request escapes unhandled.
// Every terminal outcome records one best-effort api_requests telemetry row.
// ---------------------------------------------------------------------------
export interface WithGatewayOptions {
  // The stable route label for telemetry. Kept explicit (not derived from the
  // url) so analytics are not polluted by query strings or path params.
  routeLabel: string;
  // The ordered pipeline. Compose from the stage constructors above, or use a
  // preset (gatewayPresets). Empty is allowed (provenance-only) but discouraged.
  stages: GatewayStage[];
}

export function withGateway(
  handler: GatewayHandler,
  options: WithGatewayOptions
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest): Promise<Response> => {
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    let ctx = initialContext(req);

    // Run stages in order; short-circuit on the first deny.
    for (const stage of options.stages) {
      let decision: StageDecision;
      try {
        decision = await stage(req, ctx);
      } catch {
        // A stage that throws is a server fault, not a client one: fail closed.
        return finalize(
          req,
          ctx,
          fail("Request could not be processed.", 500),
          options.routeLabel,
          method,
          startedAt
        );
      }
      if (!decision.allow) {
        logEvent("gateway.denied", {
          requestId: ctx.requestId,
          route: options.routeLabel,
          reason: decision.reason,
          status: decision.status,
          orgId: ctx.orgId ?? null,
          authMethod: ctx.authMethod,
        });
        return finalize(
          req,
          ctx,
          fail(decision.message, decision.status),
          options.routeLabel,
          method,
          startedAt
        );
      }
      if (decision.ctx) {
        ctx = decision.ctx;
      }
    }

    // All stages passed — run the handler with the resolved context.
    let response: Response;
    try {
      response = await handler(req, ctx);
    } catch {
      return finalize(
        req,
        ctx,
        fail("Internal error while processing the request.", 500),
        options.routeLabel,
        method,
        startedAt
      );
    }

    return finalize(req, ctx, response, options.routeLabel, method, startedAt);
  };
}

// Stamps the provenance request-id header on every response and records one
// best-effort telemetry row. Never throws — telemetry must not break a request.
function finalize(
  _req: NextRequest,
  ctx: RequestContext,
  response: Response,
  routeLabel: string,
  method: string,
  startedAt: number
): Response {
  const durationMs = Date.now() - startedAt;

  // Telemetry only carries an org when one was resolved (api_requests.org_id is
  // NOT NULL, so anonymous/denied-pre-authN requests are simply not recorded
  // there — the gateway.denied log line above still captures them).
  if (ctx.orgId) {
    void recordApiRequest({
      orgId: ctx.orgId,
      route: routeLabel,
      method,
      statusCode: response.status,
      durationMs,
    });
  }

  // Re-emit the response with the provenance header added. We copy headers so we
  // never mutate a handler-owned Headers instance (immutability convention).
  const headers = new Headers(response.headers);
  headers.set(REQUEST_ID_HEADER, ctx.requestId);
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers — auth resolution + CIDR matching. These delegate to or
// mirror the existing modules; none introduce new crypto.
// ---------------------------------------------------------------------------

const BEARER_PREFIX = "Bearer ";

function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const raw = header.slice(BEARER_PREFIX.length).trim();
  return raw.length > 0 ? raw : null;
}

// Resolves a user's membership (org + role). When `preferOrgId` is given, that
// org's membership is required; otherwise the user's first membership is used,
// matching how the session route enumerates memberships. Parameterized SQL only.
async function resolveMembership(
  userId: string,
  preferOrgId?: string
): Promise<{ orgId: string; role: Role } | null> {
  const pool = getPool();
  if (preferOrgId) {
    const { rows } = await pool.query<{ org_id: string; role: string }>(
      `select org_id, role
         from memberships
        where user_id = $1 and org_id = $2
        limit 1`,
      [userId, preferOrgId]
    );
    if (rows.length === 0) {
      return null;
    }
    return { orgId: rows[0].org_id, role: rows[0].role as Role };
  }
  const { rows } = await pool.query<{ org_id: string; role: string }>(
    `select org_id, role
       from memberships
      where user_id = $1
      order by created_at asc
      limit 1`,
    [userId]
  );
  if (rows.length === 0) {
    return null;
  }
  return { orgId: rows[0].org_id, role: rows[0].role as Role };
}

// Resolves an org from a raw API key by hashing it and looking up the org-scoped,
// non-revoked row — identical to lib/apiv1/gateway.ts resolveKey, reusing the
// same hashApiKey. API keys carry no per-key role column (see the api_keys
// schema), so machine callers are granted a fixed, deliberately-not-admin role
// of "editor": enough to perform write operations, never enough to administer
// the org (invite/manage keys/billing all require admin+ via rbac).
const API_KEY_ROLE: Role = "editor";

async function resolveApiKey(
  raw: string
): Promise<{ orgId: string; role: Role } | null> {
  const keyHash = hashApiKey(raw);
  const { rows } = await getPool().query<{ org_id: string }>(
    `select org_id
       from api_keys
      where key_hash = $1
        and revoked_at is null
      limit 1`,
    [keyHash]
  );
  if (rows.length === 0) {
    return null;
  }
  return { orgId: rows[0].org_id, role: API_KEY_ROLE };
}

// ---------------------------------------------------------------------------
// CIDR matching. Small, dependency-free IPv4 + IPv6 containment test. Handles
// the common cases the ip_allowlist stores; a malformed cidr or ip never throws
// — it simply does not match (so a bad rule can't accidentally admit a caller,
// and a malformed client ip can't accidentally slip past a real rule).
// ---------------------------------------------------------------------------
export function ipInCidr(ip: string, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  const base = slash === -1 ? cidr : cidr.slice(0, slash);
  const prefixStr = slash === -1 ? null : cidr.slice(slash + 1);

  const ipIsV6 = ip.includes(":");
  const baseIsV6 = base.includes(":");
  if (ipIsV6 !== baseIsV6) {
    return false; // never cross-match v4 vs v6
  }

  const bits = baseIsV6 ? 128 : 32;
  const prefix = prefixStr === null ? bits : Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) {
    return false;
  }

  const ipBig = baseIsV6 ? ipv6ToBigInt(ip) : ipv4ToBigInt(ip);
  const baseBig = baseIsV6 ? ipv6ToBigInt(base) : ipv4ToBigInt(base);
  if (ipBig === null || baseBig === null) {
    return false;
  }
  if (prefix === 0) {
    return true; // 0.0.0.0/0 or ::/0 matches everything of the same family
  }
  const shift = BigInt(bits - prefix);
  return ipBig >> shift === baseBig >> shift;
}

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let acc = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    acc = (acc << 8n) | BigInt(octet);
  }
  return acc;
}

function ipv6ToBigInt(ip: string): bigint | null {
  // Strip an optional zone id (e.g. fe80::1%eth0) — not part of the address.
  const zone = ip.indexOf("%");
  const addr = zone === -1 ? ip : ip.slice(0, zone);

  const doubleColon = addr.indexOf("::");
  let headParts: string[];
  let tailParts: string[];
  if (doubleColon === -1) {
    headParts = addr.split(":");
    tailParts = [];
  } else {
    headParts = addr.slice(0, doubleColon).split(":").filter((s) => s.length > 0);
    tailParts = addr.slice(doubleColon + 2).split(":").filter((s) => s.length > 0);
  }

  const missing = 8 - (headParts.length + tailParts.length);
  if (missing < 0 || (doubleColon === -1 && missing !== 0)) {
    return null;
  }
  const groups: string[] = [
    ...headParts,
    ...Array<string>(missing).fill("0"),
    ...tailParts,
  ];
  if (groups.length !== 8) {
    return null;
  }

  let acc = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }
    acc = (acc << 16n) | BigInt(parseInt(group, 16));
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Presets — the two most common postures, so a route composes the right chain
// without re-listing stages (and without getting the ORDER wrong). Each returns
// a fresh array so callers can extend it without sharing mutable state.
// ---------------------------------------------------------------------------
export interface SessionPresetOptions {
  routeLabel: string;
  minRole: Role;
  orgId?: string;
  rateLimit?: RateLimitOptions;
  quotaKind?: string;
}

// Browser/session-authenticated posture: authN → provenance → authZ → ip →
// rate/quota. (IP is placed after authN because the allowlist is org-scoped.)
export function sessionGateway(opts: SessionPresetOptions): GatewayStage[] {
  return [
    sessionAuthStage({ orgId: opts.orgId }),
    provenanceStage(),
    requireRoleStage(opts.minRole),
    ipAllowlistStage(),
    rateLimitStage({
      routeLabel: opts.routeLabel,
      rateLimit: opts.rateLimit,
      quotaKind: opts.quotaKind,
    }),
  ];
}

export interface ApiKeyPresetOptions {
  routeLabel: string;
  minRole: Role;
  rateLimit?: RateLimitOptions;
  quotaKind?: string;
}

// Machine/API-key posture: authN → provenance → authZ → ip → rate/quota.
export function apiKeyGateway(opts: ApiKeyPresetOptions): GatewayStage[] {
  return [
    apiKeyAuthStage(),
    provenanceStage(),
    requireRoleStage(opts.minRole),
    ipAllowlistStage(),
    rateLimitStage({
      routeLabel: opts.routeLabel,
      rateLimit: opts.rateLimit,
      quotaKind: opts.quotaKind,
    }),
  ];
}

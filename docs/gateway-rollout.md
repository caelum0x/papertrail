# Unified Gateway Chain — Rollout Plan

This document describes how PaperTrail's ~300 existing route handlers migrate
onto the new unified gateway chain (`lib/security/gatewayChain.ts`) **in waves**,
without a big-bang rewrite. It is the operational companion to
`docs/ARCHITECTURE-ENTERPRISE.md` §2 (Front door / gateway).

## What shipped (additive, no existing code touched)

- `lib/security/requestContext.ts` — a typed, immutable `RequestContext`
  (`requestId`, `orgId?`, `userId?`, `role?`, `ip`, `authMethod`) plus helpers
  to build and enrich it. PHI-free by construction: ids and coarse attributes
  only, never claim/patient text, tokens, or secrets.
- `lib/security/gatewayChain.ts` — `withGateway(handler, { routeLabel, stages })`,
  an ordered, composable request pipeline. Each stage is a small predicate
  returning allow/deny with a stable machine reason. Stages, in canonical order:
  1. **IP allow-list** (`ipAllowlistStage`) — reuses the governance
     `ip_allowlist` table; **no-op when the org has no ranges** (an org that
     never opted in is not locked out), fail-closed on lookup error.
  2. **authN** — one of `sessionAuthStage`, `apiKeyAuthStage`, `ssoAuthStage`.
     None reimplement crypto: session delegates to `lib/auth/session`,
     api-key reuses `hashApiKey` exactly like `lib/apiv1/gateway.ts`, and SSO
     reuses the session resolver (SSO callbacks land in the same cookie) and
     only relabels `authMethod` for telemetry.
  3. **authZ** (`requireRoleStage`) — `hasRoleAtLeast` from `lib/authz/rbac.ts`.
  4. **provenance** (`provenanceStage`) — request-id stamp (always on); echoed
     on every response as `x-papertrail-request-id`.
  5. **rate-limit + quota** (`rateLimitStage`) — `checkRateLimit` + optional
     `checkQuota`; rejections record a best-effort `rate_limit_events` row.
- Presets `sessionGateway(...)` / `apiKeyGateway(...)` compose the stages in the
  correct order so callers cannot get the ordering wrong.
- One demonstration route on the new primitive: `app/api/gateway/whoami/route.ts`.

Nothing in `middleware.ts`, `lib/apiv1/gateway.ts`, or any existing handler was
edited. The two front doors coexist; migration is opt-in per route.

## Why waves (and why mutating routes first)

A wrong "confident" allow is worse than an honest deny (the same principle the
verification engine follows). So we migrate where a **missing** or **inconsistent**
check is most dangerous first: routes that **mutate** tenant data or spend the
API budget. Read-only routes migrate later; they leak the least on a gap and are
the easiest to verify.

Each wave is independently shippable and independently revertible (a route's diff
is "swap the wrapper", nothing else).

### Wave 0 — Landed

- `app/api/gateway/whoami` on `sessionGateway({ minRole: "viewer" })`.
- Use it as the copy-paste reference for every subsequent wave.

### Wave 1 — Mutating, budget-spending routes (highest priority)

Target: `POST`/`PUT`/`PATCH`/`DELETE` routes that write claims/verifications or
call Claude. Examples: verification runs, evidence pipeline, drafting,
auto-synthesis, deep-research kickoff.

Migration recipe (session-authenticated write route):

```ts
import { withGateway, sessionGateway } from "@/lib/security/gatewayChain";

const ROUTE_LABEL = "verify.run";

export const POST = withGateway(handler, {
  routeLabel: ROUTE_LABEL,
  stages: sessionGateway({
    routeLabel: ROUTE_LABEL,
    minRole: "editor",     // writes require editor+
    quotaKind: "verification", // meter against the plan
  }),
});
```

The handler changes from `(req)` to `(req, ctx)` and reads `ctx.orgId` /
`ctx.role` instead of re-deriving them. Delete the route's ad-hoc session/role/
rate-limit boilerplate as you go — the chain now owns it.

### Wave 2 — Org-administration routes

Target: member management, api-key management, security policy, billing.
Use `minRole: "admin"` (or `"owner"` for billing/ownership) to match the rbac
`ACTION_MIN_ROLE` matrix. These are lower volume but high blast-radius, so they
follow the mutating-data wave once the pattern is proven.

### Wave 3 — Public API (`/api/v1/*`) routes

These already run through `lib/apiv1/gateway.ts` (`withApiKey`). Migrate them to
`apiKeyGateway(...)` **only after** confirming behavioral parity (same 401/429
semantics, same telemetry rows). Until then, leave `withApiKey` in place — it is
correct and in production. The gateway chain adds the ip-allowlist and role
stages that `withApiKey` lacks; that is the reason to migrate, not urgency.

### Wave 4 — Read-only routes

Target: dashboards, analytics, list/detail GETs. `minRole: "viewer"`, no
`quotaKind`. Lowest risk, migrated last, mostly for uniform telemetry and the
provenance header.

### Cron routes — out of scope for the chain

Routes like `app/api/cron/tick/route.ts` authenticate with a `CRON_SECRET`
bearer and have **no user/org/role context** (the secret IS the authorization).
They do not belong on the session/api-key chain and are intentionally excluded.
If a shared helper is ever wanted, extract the existing `safeEqual` +
`isAuthorized` pattern — do not force cron onto `withGateway`.

## Per-route migration checklist

- [ ] Pick the auth posture: `sessionGateway` (browser) or `apiKeyGateway` (machine).
- [ ] Set `minRole` from the rbac matrix for the route's action.
- [ ] Set `quotaKind` iff the route does billable work (a Claude call / verification).
- [ ] Choose a stable `routeLabel` (dotted, e.g. `verify.run`) — telemetry keys on it.
- [ ] Change the handler signature to `(req, ctx)` and read ids from `ctx`.
- [ ] Remove the now-duplicated session/role/rate-limit code from the handler.
- [ ] Confirm the response still uses the `ok`/`fail` envelope.
- [ ] Verify `x-papertrail-request-id` appears on the response.

## Safety invariants (must hold after every wave)

- **Fail closed.** A stage that throws → 500, never an accidental allow. A
  missing role in context → deny. An ip-lookup error → deny.
- **No secrets/PHI in logs.** Only `requestId`, `route`, `reason`, `status`,
  `orgId`, `authMethod`, counts. Never claim text, patient text, or raw tokens.
- **Org derived server-side.** The client never asserts its `orgId`; it comes
  from the session membership or the hashed api-key row.
- **Telemetry is best-effort.** A telemetry write failure never fails the
  request it describes (`api_requests`, `rate_limit_events` writes are voided).
- **Additive.** Existing front doors keep working during rollout; no wave
  requires editing `middleware.ts` or `lib/apiv1/gateway.ts`.

# PaperTrail — Compliance Controls Matrix

_Phase 3 (enterprise hardening). Companion to [`ARCHITECTURE-ENTERPRISE.md`](./ARCHITECTURE-ENTERPRISE.md)
§2. This document maps the control objectives of **SOC 2**, **HIPAA**, and **21 CFR Part 11 / GxP**
to the code modules that own them, so an auditor (or a pharma security reviewer) can trace each
requirement to a concrete, reviewable implementation — not a policy PDF._

> **Honest scope.** PaperTrail is **audit-supporting**, not **certified**. This matrix documents the
> technical controls that exist in the codebase and how they map to framework requirements. It is
> evidence for an audit, not a certification, attestation, or legal opinion. Organizational controls
> (a signed BAA, a completed SOC 2 Type II report, encryption-at-rest attestations from Neon/Vercel,
> penetration-test results) are **out of scope of this repo** and are tracked as gaps below with an
> owner. Nothing here should be read as a claim that PaperTrail is SOC 2 certified or HIPAA compliant.

## Status legend

| Status | Meaning |
|---|---|
| **implemented** | The control lives in code today and is exercised on the hot path. |
| **operationalized-phase3** | The owning module already existed; Phase 3 adds the scheduled/enforcement layer that turns a capability into a running control (a cron, an enforcement point, or a CI check). |
| **gap-with-owner** | A required organizational or infrastructure control that this repo cannot satisfy on its own; listed with the accountable owner so it is not silently assumed. |

## Design invariants the controls rest on

These three properties are the moat and are asserted before any framework mapping, because most
controls below reduce to one of them:

1. **Deterministic** — no LLM sits in the numeric or verdict path (`lib/biostats.ts`,
   `lib/structuredVerification.ts`). A control that depends on "the model behaved" is not a control;
   ours depend on parameterized SQL and pure functions.
2. **Grounded** — every flagged span is a verbatim substring of cached source `raw_text`; an
   ungroundable span is dropped, so the system structurally cannot emit an unsourced claim.
3. **Auditable** — the WORM hash chain (`lib/compliance/chain.ts`) makes every signature and
   material event tamper-evident, and the chain is re-verified on a schedule (§Part 11 below).

---

## SOC 2 (Trust Services Criteria)

Focus: Security (CC6 logical access), Availability (CC7 operations/monitoring), and Change/Confidentiality.

| Control objective | Owning module(s) | Status | Notes |
|---|---|---|---|
| **Logical access — authentication** | `lib/apiv1/gateway.ts` (`withApiKey`) resolving hashed keys from `api_keys`; session auth in the app; `app/api/cron/*` `CRON_SECRET` bearer (pattern: `app/api/cron/tick/route.ts`) | implemented | Org id is derived **server-side** from the key/session row, never client-asserted. Keys are stored as a hash (`hashApiKey`), never in plaintext. |
| **Logical access — authorization (RBAC)** | `lib/authz/rbac.ts` (`requireRole`, `can`, ordered `owner > admin > editor > viewer`) + `permission_grants` (migration `0031_rbac-teams.sql`) | implemented | Coarse capability matrix (`ACTION_MIN_ROLE`) plus per-subject grants. `requireRole` throws a 403-mapped error, so a missing check fails closed. |
| **Least privilege / access review** | RBAC + `permission_grants`; access-review job (Phase 3) | operationalized-phase3 | Roles and grants exist; Phase 3 adds a scheduled access-review surface so stale grants are periodically re-attested rather than assumed. |
| **Secrets never in logs** | `lib/logger.ts` conventions; CI log-scrubbing check (Phase 3) | operationalized-phase3 | House rule: log ids/counts only — never claim text, PHI, or API keys. Phase 3 adds a CI grep gate so a regression is caught before merge, not after. |
| **Monitoring & anomaly detection** | Threat-detection cron over `api_requests`, `rate_limit_events`, `error_events` (migrations `0043`, `0032`); alerts to `audit_chain` for regulated tenants | operationalized-phase3 | The "honest XDR" — flags key-from-new-IP, quota-exhaustion spikes, 401/403 bursts, cross-tenant probes. Built on telemetry we already own; no bolted-on SIEM. |
| **Rate limiting / abuse control** | `lib/rateLimit.ts`; quota enforcement via `checkQuota`/`recordUsage` in `lib/billing/usage.ts`; `recordRateLimitEvent` telemetry | implemented | Over-quota requests are rejected `429` **before** the engine runs, so a failed/abusive attempt never burns billable work. |
| **Change management** | Git history + CI on every commit; idempotent SQL migrations (`db/migrations/*`) | implemented | Migrations are `if not exists` / `on conflict` guarded so re-runs are safe; CI must pass before demo/deploy. |
| **Availability / health** | `/api/health` returning real status; per-org job scheduler (`app/api/cron/tick/route.ts`) | implemented | One org's failure does not abort the multi-tenant sweep (per-org try/catch). |
| **SOC 2 Type II report** | External auditor engagement | gap-with-owner | Owner: **Founder / Security lead.** A Type II report is an organizational deliverable produced by a licensed auditor over a monitoring window — not producible from code. |

---

## HIPAA (Security Rule — technical safeguards; §164.312)

Focus: access control, audit controls, integrity, transmission security, and the organizational BAA.
PaperTrail's design intent is to **avoid storing PHI**; the controls below enforce isolation and
minimize exposure regardless.

| Control objective | Owning module(s) | Status | Notes |
|---|---|---|---|
| **Access control — unique user identity** | Session/SSO auth; `api_keys` (per-key, per-org); `permission_grants` | implemented | Every actor resolves to a user or a named API key; the key row carries the org. |
| **Tenant isolation (defense in depth)** | Explicit `org_id` WHERE clauses in every query **+** RLS backstop via `app.current_org_id` GUC (migration `0033_security-rls.sql`) | implemented | A forgotten WHERE clause cannot leak cross-tenant rows: the `org_isolation` RLS policy restricts visible rows to the bound org. Org id is resolved server-side. |
| **Network access control** | `ip_allowlist` + `security_policies` (migration `0033_security-rls.sql`); Vercel WAF/BotID at the edge | operationalized-phase3 | IP-allowlist table exists; Phase 3 wires it into the gateway chain as an enforcement point and layers edge WAF. |
| **Audit controls (§164.312(b))** | `audit_log` via `lib/audit.ts` (`writeAudit`); WORM `audit_chain` via `lib/compliance/chain.ts` | implemented | Two tiers: a queryable `audit_log` and a tamper-evident hash chain for material events. |
| **Integrity (§164.312(c))** | `lib/compliance/chain.ts` (`verifyChain`) + `lib/compliance/hash.ts`; nightly chain-integrity cron (Phase 3) | operationalized-phase3 | The chain makes historical events tamper-evident; the Phase 3 cron re-verifies on a schedule so tampering is *detected*, not merely *detectable*. |
| **"No PHI/keys in logs"** | `lib/logger.ts` conventions + CI log-scrubbing check (Phase 3) | operationalized-phase3 | Same gate as SOC 2: ids/counts only. This is the primary control given the no-PHI-storage intent. |
| **Transmission security** | TLS terminated at Vercel edge; parameterized SQL only | implemented | All external evidence is cached in Neon; keys travel only as `Authorization: Bearer`. |
| **Authentication assurance (MFA/SSO)** | `mfa_factors`, `sso_connections`, `scim_directories` (migration `0030_sso-scim.sql`) | operationalized-phase3 | Schema exists; gated as an Enterprise-tier control via `plans` + feature flags. |
| **Encryption at rest** | Neon (Postgres) + Vercel platform | gap-with-owner | Owner: **Platform / Infra.** Provided by the managed platforms; requires a vendor attestation on file, not a code change. |
| **Business Associate Agreement (BAA)** | Legal + vendor (Anthropic, Neon, Vercel) | gap-with-owner | Owner: **Founder / Legal.** A signed BAA with each subprocessor that may touch PHI is a prerequisite to processing PHI and cannot be satisfied in code. |

---

## 21 CFR Part 11 / GxP (electronic records & electronic signatures)

Focus: §11.10 controls for closed systems, §11.50/§11.70 signature manifestations and record linking,
and §11.30 audit-trail integrity. This is PaperTrail's strongest regulatory surface.

| Control objective | Owning module(s) | Status | Notes |
|---|---|---|---|
| **Electronic signatures (§11.50/§11.70)** | `lib/compliance/esign.ts` (`signEntity`) | implemented | A signature binds signer + declared **meaning** + entity + timestamp + a deterministic `signed_hash`. The signing act itself is appended to the WORM chain, so the signature is anchored to the tamper-evident ledger; if the chain append fails, the whole signing fails. |
| **Audit trail — secure, computer-generated, time-stamped (§11.10(e))** | `lib/compliance/chain.ts` (`appendToChain`) + `lib/audit.ts` | implemented | Append-only, per-org, hash-chained. A per-org advisory lock serializes appends so `seq`/`prev_hash` never race. |
| **Audit-trail integrity verification** | `lib/compliance/chain.ts` (`verifyChain`); nightly **chain-integrity cron** (Phase 3) | operationalized-phase3 | `verifyChain` recomputes the whole chain and returns the first break (non-contiguous seq, broken linkage, or tampered event). Phase 3 runs it on a schedule and raises an alarm on `ok: false`. |
| **Record retention (§11.10(c))** | `lib/compliance/retention.ts` + `lib/governance/retention.ts`; `retention_policies` (migration `0057_retention.sql`) | implemented | One retention window per `(org, entity_type)`, idempotently upserted. |
| **Retention enforcement (purge)** | Retention **purge cron** (Phase 3) over `retention_policies` | operationalized-phase3 | Policies existed but were advisory; Phase 3 adds the scheduled purge worker that actually expires records past `retain_days` while preserving the append-only `audit_chain`. |
| **Copies of records / audit export** | `lib/compliance/chain.ts` (`listChainEntries`), `lib/compliance/esign.ts` (`listSignatures`); export surface | implemented | Chain and signature history are listable and exportable for an inspector. |
| **Limiting system access to authorized individuals (§11.10(d))** | `lib/authz/rbac.ts` + `permission_grants` + hashed `api_keys` | implemented | Same access-control spine as SOC 2/HIPAA; signing requires an authenticated, authorized actor (`Ctx`). |
| **System validation (§11.10(a))** | Deterministic engines + oracle tests (`tests/*`) | operationalized-phase3 | The no-LLM-in-the-numeric-path invariant makes behavior reproducible and testable; a formal validation package (IQ/OQ/PQ) is the organizational deliverable below. |
| **Formal computer-system validation (CSV) package** | QA / RA | gap-with-owner | Owner: **Founder / RA (regulatory affairs).** IQ/OQ/PQ documentation and a validation plan are GxP deliverables authored against a controlled environment, not code artifacts. |

---

## Phase 3 crons at a glance

The three new scheduled controls all authenticate with the `CRON_SECRET` bearer pattern from
`app/api/cron/tick/route.ts` and are additive (new routes, existing modules):

| Cron | Reads | Owning logic | Turns which capability into a running control |
|---|---|---|---|
| **Threat-detection** | `api_requests`, `rate_limit_events`, `error_events` | anomaly rules → `audit_chain` | SOC 2 monitoring; HIPAA anomaly detection |
| **Retention purge** | `retention_policies` | `lib/compliance/retention.ts` / `lib/governance/retention.ts` | Part 11 retention enforcement |
| **Chain-integrity** | `audit_chain` | `lib/compliance/chain.ts` (`verifyChain`) | Part 11 / HIPAA audit-trail integrity |

## How to read a row for an audit

For any control marked **implemented** or **operationalized-phase3**, the owning module is a real,
reviewable file in this repo. An auditor can: (1) open the module, (2) trace it to the migration that
defines its table, and (3) exercise it against the deterministic test fixtures. For any
**gap-with-owner** row, the named owner is accountable for the organizational deliverable; the gap is
recorded here deliberately so it is never silently assumed to be satisfied by the software alone.

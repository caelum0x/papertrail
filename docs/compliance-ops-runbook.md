# PaperTrail — Compliance Controls Operations Runbook

_Phase 3 (enterprise hardening). Companion to [`ARCHITECTURE-ENTERPRISE.md`](./ARCHITECTURE-ENTERPRISE.md)
§2 and the control matrix in [`compliance-controls.md`](./compliance-controls.md). This document covers
the **operationalization** of the compliance controls — the scheduled jobs and admin reviews that
actually EXERCISE the control modules whose data models already existed but which nothing ran._

The compliance data models (retention policies, the WORM audit chain, RBAC permission grants) shipped
earlier. What was missing was the machinery that RUNS them on a schedule and surfaces the outcome. This
part adds that machinery as **new, composable primitives** — it does not rewrite any existing route
handler, `middleware.ts`, or `lib/apiv1/gateway.ts`.

## What runs

| Control | Trigger | Entry point | Core module | Records to |
|---|---|---|---|---|
| Data-retention purge | Vercel Cron `0 4 * * *`, `CRON_SECRET` Bearer | `GET /api/cron/retention-purge` | `lib/governance/retentionPurge.ts` | `audit_log` + `compliance_control_runs` |
| Audit-chain integrity | Vercel Cron `30 3 * * *`, `CRON_SECRET` Bearer | `GET /api/cron/chain-integrity` | `lib/compliance/chainIntegrity.ts` (reuses `verifyChain`) | `audit_log` (high-severity on break) + `compliance_control_runs` |
| Access review | On-demand, admin, `withOrg` | `GET /api/governance/access-review` | `lib/governance/accessReview.ts` | `audit_log` + `compliance_control_runs` |
| Controls status | On-demand, admin, `withOrg` | `GET /api/governance/compliance-controls` | `lib/complianceOps/runLedger.ts` | — (read-only) |

The console surface is `app/console/compliance/controls/page.tsx` (admin-only): last purge run,
chain-integrity status, and the access-review posture with a downloadable JSON snapshot.

## New primitives (composable, additive)

- **`lib/complianceOps/types.ts`** — Zod-validated shapes for control runs, purge results, chain-integrity
  results, and the access-review snapshot. Every shape is counts/ids only; no claim/patient text.
- **`lib/complianceOps/runLedger.ts`** — `recordControlRun` / `latestRunsByControl` over the new
  `compliance_control_runs` table (`db/migrations/0066_compliance-ops.sql`). Best-effort writes; a ledger
  write never aborts the control it describes.
- **`lib/governance/retentionPurge.ts`** — `purgeOrgRetention(orgId)`: reads `retention_policies` and
  acts on rows past their window via a fixed internal **registry** mapping known `entity_type`s to a
  governed table + strategy (`delete` or in-place `anonymize`). Unknown entity types are skipped, never
  guessed. Org-scoped, parameterized, best-effort per entity type.
- **`lib/compliance/chainIntegrity.ts`** — `checkOrgChainIntegrity` / `sweepChainIntegrity`: reuses the
  existing `verifyChain`, never throws (a broken chain is data), writes a high-severity audit on a break.
- **`lib/governance/accessReview.ts`** — `buildAccessReviewSnapshot(orgId)`: assembles every role
  (`memberships`), explicit permission grant (`permission_grants`), and custom-role bundle
  (`custom_roles`) into one validated, downloadable snapshot.

## Safety invariants

- **No sensitive data in logs or the run ledger.** Every audit entry, control-run row, and cron response
  carries counts / ids / coarse status / short non-sensitive reasons only — never claim text, patient
  text, API keys, or per-row payloads. The retention purge reports *how many* rows it deleted or
  anonymized, not *which*.
- **Cron auth = the secret.** The two cron routes authenticate with the shared `CRON_SECRET` Bearer token
  exactly like `app/api/cron/tick/route.ts` (constant-time compare, fail-closed when the secret is unset).
  There is no user session in a cron run, so the secret IS the authorization.
- **Org-scoped by construction.** Every query filters `org_id` first, always the resolved server-side org
  id — never a client-supplied value. All SQL is parameterized; the only interpolated identifiers in the
  purge are fixed internal registry constants (table/column names), never client input.
- **Best-effort, isolated failures.** One org's failure never aborts a multi-org sweep; one entity type's
  purge failure never aborts the rest of that org's purge.

## Retention purge registry

`retention_policies.entity_type` is a client-chosen label, so `purgeOrgRetention` only ever COMPARES it
against a fixed registry — it never reaches SQL as an identifier. Current entries:

| `entity_type` | Table | Strategy | Effect |
|---|---|---|---|
| `claims` | `claims` | `anonymize` | Null out `text`, `cited_source_url` in place (row kept so audit links survive) |
| `evidence_reports` | `evidence_reports` | `delete` | Hard-delete rows past the window |

Extend the registry deliberately in `lib/governance/retentionPurge.ts`. Any `entity_type` with no registry
entry is **skipped** (reported, never acted on) — the safe default: we never delete from a table we don't
recognize.

## Rollout to existing routes

This part follows the MOAT/SAFETY rule: it ships new primitives and applies them to the **new** routes it
creates, and documents (here) how to roll them out to the ~300 existing handlers without a rewrite.

1. **Schedules are additive.** The two new cron entries were appended to `vercel.json` alongside the
   existing `/api/cron/tick`; no existing schedule changed. Set `CRON_SECRET` in the Vercel project (it is
   already documented in `.env.example`) — the same secret already used by `/api/cron/tick`.
2. **Migration.** `db/migrations/0066_compliance-ops.sql` is idempotent (`create table if not exists`).
   Run `npm run db:migrate`; it adds only the new `compliance_control_runs` table and indexes — no existing
   table is altered.
3. **Extending retention coverage.** To govern a new data class, add a row to the registry in
   `retentionPurge.ts` (table, time column, strategy). Prefer `anonymize` for any table holding claim or
   patient text so the row survives for the audit trail; reserve `delete` for derived artifacts. No route
   handler changes are required.
4. **Wiring existing admin surfaces.** The controls console links from the existing
   `/console/compliance` page; the status endpoint (`/api/governance/compliance-controls`) is admin-gated
   via the existing `withOrg` + `requireRole('admin')` primitives, so no existing route was modified to
   expose it.
5. **Emitting control runs from existing jobs (optional, future).** Any existing scheduled job that
   already enforces a control can begin surfacing its outcome by calling `recordControlRun(...)` with
   counts only — a one-line, additive change per job, no behavior change to the job itself.

## Verifying a run manually

```bash
# Retention purge (all orgs). Reports counts only.
curl -H "Authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/retention-purge

# Nightly chain integrity (all orgs). Reports ok/broken counts + break seqs.
curl -H "Authorization: Bearer $CRON_SECRET" https://<deploy>/api/cron/chain-integrity

# Access review snapshot (admin session; org via x-org-id). Download artifact:
curl -b "<session-cookie>" -H "x-org-id: <org-id>" \
  "https://<deploy>/api/governance/access-review?download=1" -o access-review.json
```

An unauthorized cron call returns `401` without revealing whether the secret is unset or mismatched.

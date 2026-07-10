export const meta = {
  name: 'enterprise-infra',
  description: 'Enterprise infrastructure for the regulated-pharma Evidence Intelligence platform: data-source provenance registry, versioned /api/v1 gateway with API-key quotas, per-engine usage metering, validation/compliance status, tamper-evident evidence audit chain, per-engine SLA observability, evidence-event webhooks, and data governance (retention + DSAR export). All org-scoped, disjoint new namespaces, deterministic, tested.',
  whenToUse: 'Build the enterprise/governance layer that makes the evidence platform sellable to regulated pharma (FDA/HTA-grade auditability).',
  phases: [
    { title: 'Build', detail: '8 parallel disjoint enterprise verticals' },
    { title: 'Verify', detail: 'adversarial: org-scoped, deterministic, tested' },
    { title: 'Report', detail: 'enterprise pieces + wiring' },
  ],
}

const CTX = `PaperTrail is a regulated-pharma EVIDENCE INTELLIGENCE platform (see docs/enterprise-evidence-
platform.md). Next.js 16 / TS strict / Postgres+pgvector. Build the ENTERPRISE/GOVERNANCE layer — the
auditability + API + metering + governance a pharma medical-affairs/regulatory buyer legally requires.
Backend, org-scoped, minimal/NO frontend.

CONVENTIONS (match exactly): ORG-scoped routes use withOrg from lib/api/handler (ctx.org.id) + requireRole
for mutations + writeAudit from lib/audit; org_id is ALWAYS the first predicate; NEVER trust a client
org_id. Repos follow lib/*/repository.ts (READ lib/signatures/repository.ts or app/api/billing/lib/
repository.ts for the org-scoped row pattern). Public envelope via lib/api/response (ok/created/fail).
Migrations: db/migrations/NNNN_name.sql applied in order — READ db/migrations/0001_foundation.sql +
0049_evidence-reports.sql for house style (org_id uuid FK, created_at timestamptz default now(), indexes,
IF NOT EXISTS). Reuse existing modules by IMPORT only (do NOT edit them): lib/audit, lib/api-keys/apiusage,
lib/webhooks, lib/billing, lib/observability, lib/authz/rbac. Every new lib file is pure/immutable data
access or deterministic logic; explicit errors; parameterized SQL only. Each vertical owns ONLY its listed
files (disjoint namespaces) so this runs safely alongside other in-flight workflows.`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'filesWritten', 'orgScoped', 'summary'],
  properties: {
    vertical: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    orgScoped: { type: 'boolean' }, summary: { type: 'string' },
    publicExports: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'orgScopedCorrectly', 'rbacEnforced', 'tested', 'issues'],
  properties: {
    vertical: { type: 'string' }, orgScopedCorrectly: { type: 'boolean' }, rbacEnforced: { type: 'boolean' },
    tested: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const VERTICALS = [
  {
    key: 'provenance-registry', label: 'ent:data-source-registry',
    prompt: CTX + `

BUILD the DATA-SOURCE PROVENANCE REGISTRY — the audit an FDA/HTA reviewer expects: every evidence number
traces to a source record with its database, version/snapshot date, license, and access timestamp. Own ONLY:
db/migrations/0053_data-source-registry.sql, lib/governance/dataSources.ts, lib/governance/dataSources.schemas.ts,
app/api/governance/data-sources/route.ts, tests/dataSourceRegistry.test.ts.
- 0053: table evidence_data_sources (id uuid pk default gen_random_uuid(), source_key text, display_name
  text, database_version text, license text, url text, last_accessed_at timestamptz, snapshot_date date null,
  created_at timestamptz default now(), unique(source_key)); + an access-log table evidence_source_accesses
  (id, source_key, org_id uuid null, purpose text, accessed_at timestamptz default now()).
- lib/governance/dataSources.ts: a documented static catalog of the platform's open sources (open_targets,
  gwas_catalog, clinvar, chembl, pharmgkb, faers, pubtator, pubmed, clinicaltrials) with license + url, plus
  repo functions upsertSource, recordAccess(sourceKey, orgId, purpose), listSources, getAccessLog.
- app/api/governance/data-sources/route.ts: withOrg GET (any member) lists the registry + the org's recent
  accesses. Public reference facts, but the access log is org-scoped.
tests: over a mock pool assert the catalog is seeded, recordAccess writes org-scoped rows, and getAccessLog
filters by org_id first.`,
  },
  {
    key: 'api-v1', label: 'ent:enterprise-api-v1',
    prompt: CTX + `

BUILD the versioned ENTERPRISE API v1 gateway over the evidence/bio engines, authenticated by ORG API KEYS
with per-plan quotas. Own ONLY: lib/apiv1/gateway.ts, app/api/v1/evidence/verify/route.ts,
app/api/v1/bio/verify-claim/route.ts, app/api/v1/health/route.ts, tests/apiV1Gateway.test.ts.
- lib/apiv1/gateway.ts: withApiKey(handler) — resolve the org from an 'Authorization: Bearer <api_key>'
  header (READ lib/api-keys / lib/apiusage for the existing key model; import the verify+usage functions; do
  NOT edit them), enforce the key's per-plan rate/quota, record usage, and pass an ApiCtx { orgId } to the
  handler. Reject 401 on a bad/absent key, 429 on quota. Never trust a client org id.
- The v1 routes wrap EXISTING engines behind withApiKey: /v1/evidence/verify -> runEvidencePipeline (import
  from lib/evidencePipeline), /v1/bio/verify-claim -> verifyBiomedicalClaim (import from lib/bio/
  verifyBiomedicalClaim), /v1/health -> a public status. Stable versioned JSON envelope.
tests: mock the key store; assert 401 without a key, 200 + usage recorded with a valid key, 429 over quota.`,
  },
  {
    key: 'metering', label: 'ent:engine-usage-metering',
    prompt: CTX + `

BUILD PER-ENGINE USAGE METERING — meter every evidence/bio engine call + Claude-token usage per org, for
billing + quotas. Own ONLY: db/migrations/0054_engine-usage.sql, lib/metering/engineUsage.ts,
lib/metering/engineUsage.schemas.ts, app/api/usage/engines/route.ts, tests/engineUsage.test.ts.
- 0054: table engine_usage (id uuid pk, org_id uuid, engine text, units int default 1, claude_tokens int
  default 0, occurred_at timestamptz default now()) + index (org_id, occurred_at desc), (org_id, engine).
- lib/metering/engineUsage.ts: recordEngineUsage(pool, {orgId, engine, units?, claudeTokens?}) and
  summarizeUsage(pool, {orgId, since?}) -> per-engine counts + token totals; org_id first predicate. A pure
  meter() helper too.
- app/api/usage/engines/route.ts: withOrg GET -> the org's per-engine usage summary.
tests: over a mock pool assert recordEngineUsage writes org rows and summarizeUsage aggregates per engine,
org-scoped.`,
  },
  {
    key: 'validation', label: 'ent:validation-compliance',
    prompt: CTX + `

BUILD the VALIDATION / COMPLIANCE STATUS framework — a per-evidence-run record of which engines ran, which
sources were reachable, coverage, and a documented deterministic quality score, so a submission carries its
own validation report. Own ONLY: db/migrations/0055_validation-status.sql, lib/validation/status.ts,
lib/validation/status.schemas.ts, app/api/validation/route.ts, tests/validationStatus.test.ts.
- 0055: table validation_runs (id uuid pk, org_id uuid, subject text, engines_run jsonb, sources_reachable
  jsonb, coverage numeric, quality_score numeric, status text, created_at timestamptz default now()) +
  index (org_id, created_at desc).
- lib/validation/status.ts: computeValidationStatus({ enginesRun, sourcesReachable, requiredEngines }) ->
  { coverage (ran/required), qualityScore (documented weighting of coverage + source reachability), status:
  complete|partial|insufficient } — PURE + deterministic. recordValidationRun(pool, orgId, subject, status)
  persists it (org-scoped).
- app/api/validation/route.ts: withOrg POST records a run + GET lists the org's runs.
tests: assert the deterministic coverage/quality/status logic + org-scoped persistence over a mock pool.`,
  },
  {
    key: 'evidence-audit', label: 'ent:evidence-audit-chain',
    prompt: CTX + `

BUILD a TAMPER-EVIDENT EVIDENCE AUDIT CHAIN — a hash-chained, org-scoped log of evidence actions (dossier
built, claim verified, source accessed, approval signed) for 21 CFR Part 11-grade defensibility. Own ONLY:
db/migrations/0056_evidence-audit.sql, lib/governance/evidenceAudit.ts, lib/governance/evidenceAudit.schemas.ts,
app/api/governance/audit-chain/route.ts, tests/evidenceAudit.test.ts.
- 0056: table evidence_audit_chain (id uuid pk, org_id uuid, seq bigint, action text, entity_type text,
  entity_id text, actor uuid null, payload jsonb, prev_hash text, hash text, created_at timestamptz default
  now(), unique(org_id, seq)). Do NOT reuse the general audit table — this is a per-org verifiable chain.
- lib/governance/evidenceAudit.ts: appendEvidenceAudit(pool, orgId, entry) computes hash =
  sha256(prev_hash + canonical(entry)) via node:crypto, incrementing seq per org; verifyEvidenceChain(pool,
  orgId) recomputes and returns { valid, brokenAtSeq? }. Org_id first predicate; parameterized SQL.
- app/api/governance/audit-chain/route.ts: withOrg GET -> the org's chain + a verify result (requireRole
  auditor/admin if such a role exists, else any member read).
tests: over a mock pool assert the chain links correctly, verifyEvidenceChain detects a tampered payload,
and everything is org-scoped.`,
  },
  {
    key: 'sla-observability', label: 'ent:engine-sla-observability',
    prompt: CTX + `

BUILD PER-ENGINE SLA OBSERVABILITY — latency/availability metrics per evidence/bio engine + a status
endpoint, so operators (and an enterprise SLA) can see engine health. Own ONLY: lib/obsv/engineMetrics.ts,
lib/obsv/engineMetrics.schemas.ts, app/api/observability/engines/route.ts, tests/engineMetrics.test.ts.
- lib/obsv/engineMetrics.ts: an in-process rolling metrics recorder recordEngineCall({engine, latencyMs,
  ok}) + engineSlaSummary() -> per-engine { calls, errorRate, p50, p95 latency } computed deterministically
  from a bounded ring buffer (documented window). Pure math (percentiles) — no external deps. Export a
  withEngineMetrics(engine, fn) wrapper that times + records a call.
- app/api/observability/engines/route.ts: public GET (cheap) -> the SLA summary (no secrets, no claim text).
tests: feed a fixed sequence of calls and assert exact p50/p95/errorRate.`,
  },
  {
    key: 'evidence-webhooks', label: 'ent:evidence-event-webhooks',
    prompt: CTX + `

BUILD EVIDENCE-EVENT WEBHOOKS — emit org webhooks on evidence lifecycle events (evidence.verified,
dossier.built, dossier.published, signal.detected). Own ONLY: lib/events/evidenceEvents.ts,
lib/events/evidenceEvents.schemas.ts, app/api/events/evidence/route.ts, tests/evidenceEvents.test.ts.
- lib/events/evidenceEvents.ts: emitEvidenceEvent(pool, orgId, { type, entityType, entityId, data }) that
  looks up the org's webhook subscriptions (READ lib/webhooks for the existing subscription+delivery model;
  import its dispatch/enqueue; do NOT edit it) and enqueues a delivery for matching event types. A typed
  EVIDENCE_EVENT_TYPES list. Never include claim text in the payload beyond ids/verdict metadata.
- app/api/events/evidence/route.ts: withOrg GET -> the org's recent emitted evidence events (org-scoped log)
  — add a small evidence_events log table IF lib/webhooks doesn't already record deliveries; otherwise reuse.
tests: mock the webhook store + pool; assert emitEvidenceEvent enqueues only for matching subscriptions and
never leaks claim text.`,
  },
  {
    key: 'governance-retention', label: 'ent:data-governance-retention',
    prompt: CTX + `

BUILD DATA GOVERNANCE — org data-retention policy + a DSAR-style export of an org's evidence artifacts. Own
ONLY: db/migrations/0057_retention.sql, lib/governance/retention.ts, lib/governance/retention.schemas.ts,
app/api/governance/retention/route.ts, app/api/governance/export/route.ts, tests/retention.test.ts.
- 0057: table org_retention_policies (org_id uuid pk, evidence_reports_days int null, engine_usage_days int
  null, audit_days int null, updated_at timestamptz default now()).
- lib/governance/retention.ts: getPolicy/setPolicy (org-scoped), applyRetention(pool, orgId) that deletes
  rows older than the policy from the org's evidence_reports/engine_usage (import table names; parameterized
  deletes, org_id first predicate), and exportOrgEvidence(pool, orgId) that gathers the org's evidence
  artifacts into a single JSON bundle for a data-subject/portability export.
- routes: withOrg GET/PUT retention policy (requireRole admin for PUT); withOrg GET export -> the JSON bundle.
tests: over a mock pool assert setPolicy/getPolicy round-trip, applyRetention deletes only the org's aged
rows, and exportOrgEvidence bundles org-scoped data.`,
  },
]

phase('Build')
log('Building 8 enterprise-infrastructure verticals in parallel…')
const built = await pipeline(
  VERTICALS,
  (v) => agent(v.prompt, { label: v.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, v) => {
    if (!build) return { vertical: v.key, build: null, verdict: null }
    return agent(
      CTX + '\n\nADVERSARIALLY VERIFY the "' + v.key + '" vertical. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm: orgScopedCorrectly (every query has org_id as the FIRST predicate; NO client-supplied org id is
trusted — it comes from ctx/api-key), rbacEnforced (mutations gate with requireRole where appropriate),
tested (org-scoping + the deterministic logic covered over a mock pool; run the test). Hash chains must be
tamper-evident; percentiles/scores exact. Put real problems in issues as 'blocker'; default booleans false
if unconfirmed.`,
      { label: 'verify:' + v.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ vertical: v.key, build, verdict }))
  }
)
const results = built.filter(Boolean)
const solid = results.filter((r) => r.verdict?.orgScopedCorrectly && r.verdict?.tested)
log('Built ' + solid.length + '/' + results.length + ' enterprise verticals (org-scoped, tested).')

phase('Report')
return {
  verticals: results.map((r) => ({
    vertical: r.vertical, files: r.build?.filesWritten || [], orgScoped: r.build?.orgScoped ?? null,
    orgScopedCorrectly: r.verdict?.orgScopedCorrectly ?? null, tested: r.verdict?.tested ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  solid: solid.length, total: results.length,
}

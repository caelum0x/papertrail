export const meta = {
  name: 'build-enterprise-hardening',
  description: 'Phase 3: unified gateway chain + threat-detection XDR + compliance ops + plan tiers + controls matrix',
  phases: [
    { title: 'Build', detail: 'gateway, XDR, compliance-ops, tiers, docs — parallel disjoint files' },
    { title: 'Verify', detail: 'adversarial review' },
  ],
}

const CONTRACT = [
  'PAPERTRAIL ENTERPRISE HARDENING (Phase 3). See docs/ARCHITECTURE-ENTERPRISE.md section 2. Goal: Anthropic/',
  'Claude-grade enterprise posture on the EXISTING stack (Next.js 16, Postgres/Neon, Vercel). Decision already',
  'made: BUILD the gateway in TypeScript, do NOT fork Envoy — consolidate the scattered front door into one',
  'ordered chain, and build "XDR" threat detection on telemetry we already own (api_requests, rate_limit_events,',
  'error_events). Operationalize the compliance controls whose modules already exist.',
  '',
  'MOAT/SAFETY: ADDITIVE work only. Do NOT rewrite the ~300 existing route handlers, middleware.ts, or',
  'lib/apiv1/gateway.ts internals — build NEW composable primitives + apply them to the NEW routes you create,',
  'and document the rollout for existing routes. Never log secrets, PHI, claim/patient text — only ids/counts.',
  'Cron routes authenticate with CRON_SECRET Bearer like the existing app/api/cron/tick/route.ts.',
  '',
  'READ FIRST: app/api/cron/tick/route.ts (CRON_SECRET pattern), lib/apiv1/gateway.ts (withApiKey), lib/authz/',
  'rbac.ts (requireRole/Role), lib/rateLimit.ts, lib/compliance/* (chain.ts — the WORM audit chain + any',
  'verifyChain), lib/governance/* (dataSources, retention), lib/billing/usage.ts (checkQuota/recordUsage/plans),',
  'lib/audit.ts (writeAudit), and recent db/migrations (for the api_requests / rate_limit_events / error_events /',
  'retention_policies / plans / feature-flags table shapes). Match house style: lower-case idempotent SQL,',
  'gen_random_uuid() pks, ok/fail envelope (lib/api/response), zod validation, org-scoped queries filter org_id.',
].join('\n')

const GROUPS = [
  {
    key: 'gateway',
    body:
      'Build the unified, composable gateway chain as a NEW primitive (do not edit middleware.ts or gateway.ts).' +
      ' Files: lib/security/gatewayChain.ts — an ordered, composable request pipeline withGateway(handler, opts)' +
      ' that runs, in order: (1) IP allow-list check (reuse governance ip rules if present, else no-op),' +
      ' (2) authN (session OR api-key OR sso — reuse existing resolvers; do not reimplement crypto),' +
      ' (3) authZ (requireRole via rbac.ts), (4) a per-request provenance/request-id stamp,' +
      ' (5) rate-limit + quota (reuse checkRateLimit + checkQuota). Each stage is a small pure predicate that' +
      ' returns allow/deny with a reason; compose them so a route opts into exactly the stages it needs.' +
      ' Also lib/security/requestContext.ts (a typed RequestContext: requestId, orgId?, role?, ip). Provide a' +
      ' short ROLLOUT.md (docs/gateway-rollout.md) describing how existing routes migrate onto withGateway in' +
      ' waves (mutating routes first). Apply withGateway to ONE new demonstration route',
    build: true,
  },
  {
    key: 'xdr',
    body:
      'Build the tenant-scoped threat-detection ("XDR") on owned telemetry. Files: db/migrations/0064_security-events.sql' +
      ' (idempotent: security_events(id uuid pk, org_id uuid, kind text, severity text, detail jsonb, source_ip' +
      ' text, detected_at timestamptz default now()); indexes on (org_id, detected_at desc), (severity)).' +
      ' lib/security/threatDetection.ts — pure detectors over api_requests / rate_limit_events / error_events per' +
      ' org: apiKeyFromNewIp, quotaExhaustionSpike, authFailureBurst (401/403), crossTenantProbe. Each returns' +
      ' typed SecurityEvent candidates (deterministic thresholds, NO LLM). lib/security/securityScan.ts —' +
      ' runOrgSecurityScan(pool, orgId) persists new events (dedup) + appends a security event to the audit chain' +
      ' for high severity. app/api/cron/security-scan/route.ts — CRON_SECRET Bearer, sweeps all orgs.' +
      ' app/api/security/events/route.ts — withOrg (viewer) list of an org security_events. app/console/admin/' +
      ' security/page.tsx + _components — the security dashboard (event feed + severity filters). Never log raw text.',
    build: true,
  },
  {
    key: 'compliance-ops',
    body:
      'Operationalize the compliance controls (modules exist; nothing runs them). Files: (1) lib/governance/' +
      'retentionPurge.ts + app/api/cron/retention-purge/route.ts (CRON_SECRET) — read retention_policies and' +
      ' actually purge/anonymize rows past retention, org-scoped, best-effort + audited via writeAudit; report' +
      ' counts only. (2) lib/compliance/chainIntegrity.ts + app/api/cron/chain-integrity/route.ts — nightly' +
      ' verifyChain() over each org audit chain; on a broken seq/hash, write a high-severity audit + return a' +
      ' failure report (do not throw). Reuse the existing chain verify if present. (3) lib/governance/' +
      'accessReview.ts + app/api/governance/access-review/route.ts (withOrg admin) — list every role/permission' +
      ' grant per org for a periodic access review, plus a downloadable snapshot. (4) app/console/compliance/' +
      'controls/page.tsx — surface the last purge run, chain-integrity status, and access-review snapshot.' +
      ' Parameterized SQL, org-scoped, never log sensitive fields.',
    build: true,
  },
  {
    key: 'tiers',
    body:
      'Formalize packaging into Researcher / Team / Pharma-Enterprise tiers enforced by the EXISTING plans +' +
      ' checkQuota + feature-flags stack (do not invent a new billing system). Files: db/migrations/' +
      '0065_plan-tiers.sql (idempotent: upsert three plan rows researcher/team/enterprise with per-tier limits;' +
      ' add a plan_features(plan text, feature text, enabled boolean) table if one does not already exist).' +
      ' lib/billing/tiers.ts — the tier catalog (limits + gated features: sso, scim, ip_allowlist, audit_export,' +
      ' esign, worker_priority) + requireFeature(pool, orgId, feature) that reads the org plan and throws a typed' +
      ' UpgradeRequired when a gated feature is used below its tier. app/api/billing/tier/route.ts (withOrg) —' +
      ' current tier + entitlements. app/console/billing/tier/page.tsx — a tier/entitlement page + upgrade CTA.' +
      ' Gate Part-11 e-sign + immutable audit export + SSO/SCIM as Enterprise-only in the catalog. READ' +
      ' lib/billing/usage.ts + the plans migration first so limits align.',
    build: true,
  },
  {
    key: 'docs',
    body:
      'Author the trust + compliance surface. Files: docs/compliance-controls.md — a controls matrix mapping SOC 2,' +
      ' HIPAA, and 21 CFR Part 11 / GxP to the OWNING code modules (rbac.ts, permission_grants, api_keys hashing,' +
      ' audit_log, lib/compliance/chain.ts, esign.ts, retention, RLS, SSO/SCIM, the new threat-detection + purge +' +
      ' chain-integrity crons), each with a status (implemented | operationalized-phase3 | gap-with-owner).' +
      ' app/security/page.tsx — a PUBLIC trust page (no auth) summarizing the security posture (deterministic +' +
      ' grounded + auditable moat, tenant isolation in depth, WORM audit chain, threat detection, tiers) with an' +
      ' honest "audit-supporting provenance, not certified" disclaimer. Match the /connect public page style' +
      ' (theme tokens, sections). Do NOT overclaim certification. READ docs/ARCHITECTURE-ENTERPRISE.md first.',
    build: true,
  },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['group', 'filesCreated'],
  properties: {
    group: { type: 'string' },
    filesCreated: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    followups: { type: 'array', items: { type: 'string' } },
  },
}

phase('Build')
const built = (await parallel(
  GROUPS.map((g) => () =>
    agent(
      [
        'Build ONE part of PaperTrail Phase 3 (enterprise hardening): ' + g.key + '.',
        '',
        CONTRACT,
        '',
        'YOUR PART:',
        g.body,
        '',
        'Ship complete, working, typed code (no TODOs, no any). Do NOT run npm/tsc. Create ONLY your files; do',
        'not edit middleware.ts, lib/apiv1/gateway.ts, layout.tsx, or other parts\' files. Return files created.',
      ].join('\n'),
      { label: 'build:' + g.key, phase: 'Build', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review PaperTrail Phase 3 (enterprise hardening). READ lib/security/*, app/api/cron/',
    'security-scan|retention-purge|chain-integrity, app/api/security/events, app/api/governance/access-review,',
    'app/api/billing/tier, lib/billing/tiers.ts, lib/governance/retentionPurge.ts, lib/compliance/chainIntegrity.ts,',
    'db/migrations/0064_security-events.sql, db/migrations/0065_plan-tiers.sql, the new console pages,',
    'app/security/page.tsx, and docs/compliance-controls.md. Check: cron routes require CRON_SECRET Bearer;',
    'org-scoped queries filter org_id (no cross-tenant leak); threat detectors are deterministic (no LLM) with',
    'sensible thresholds; migrations idempotent + correctly numbered (0064, 0065 unique); retention purge is',
    'guarded/audited; chain-integrity never throws; tier gating reads the real plan; nothing logs secrets/PHI;',
    'the public /security page does not overclaim certification; obvious TypeScript build risks. Report concrete',
    'issues with file + fix.',
  ].join('\n'),
  { label: 'verify:enterprise', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('Phase 3 built: ' + built.length + ' parts; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }

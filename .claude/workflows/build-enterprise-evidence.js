export const meta = {
  name: 'build-enterprise-evidence',
  description: 'Enterprise + evidence depth: living evidence monitoring, verdict fragility, gated audit export, DSAR + legal hold',
  phases: [
    { title: 'Build', detail: 'four features in parallel, disjoint files' },
    { title: 'Verify', detail: 'adversarial review' },
  ],
}

const CONTRACT = [
  'PAPERTRAIL — enterprise + evidence depth. Live at https://papertrail-topaz-phi.vercel.app. Deepen the',
  'deterministic + grounded + auditable moat; specialize OSS engines IN PLACE where noted (edit backend/engines/).',
  '',
  'MOAT RULES (non-negotiable): NO LLM in any numeric/verdict/scoring path — deterministic math + rules decide;',
  'Claude only for language steps that then get grounded via lib/grounding.ts locateSpan (drop + count',
  'ungroundable). Prefer honest insufficient over a forced answer. Never log claim/patient/source text (ids/counts only).',
  '',
  'STACK: Next.js 16, TS strict, Postgres/Neon (getPool from @/lib/db, parameterized $1 SQL). ORG-SCOPED routes use',
  'withOrg + requireRole from @/lib/api/handler + @/lib/authz/rbac (ctx.org.id, ok/fail from @/lib/api/response);',
  'PUBLIC compute routes follow app/api/bio/genetic-association/route.ts (runtime nodejs, IP checkRateLimit, zod',
  'safeParse, ok/fail, try/catch). Additive idempotent migrations. Edits to existing core files must be SURGICAL +',
  'additive (new fn/field; never rewrite; read first). Console pages use theme tokens bg-paper/text-ink/text-accent/',
  'border-ink/15 (read app/console/hypotheses/page.tsx for the client pattern; org-scoped pages send x-org-id like',
  'app/console/connectors/_components/api.ts).',
  '',
  'FILE OWNERSHIP IS DISJOINT (do not touch another part\'s files, middleware.ts, layout.tsx, mcp/src/server.ts):',
  '  living     -> NEW migration 0069 + lib/livingEvidence/* + app/api/evidence/living + console + backend/engines/pyalex/',
  '  fragility  -> NEW lib/evidenceFragility.ts + app/api/evidence/fragility + console (reuse trialSequential/metaAnalysis; no edits to them)',
  '  audit-export -> NEW lib/enterprise/auditExport.ts + app/api/enterprise/audit-export + console (reuse chain.ts/chainOfCustody/tiers; no edits)',
  '  governance -> NEW migration 0070 + lib/governance/dsar.ts + lib/governance/legalHold.ts + app/api/governance/dsar + app/api/governance/legal-hold + console',
].join('\n')

const GROUPS = [
  {
    key: 'living',
    body:
      'LIVING EVIDENCE MONITORING. A monitor watches a topic/claim; when NEW evidence lands it recomputes and' +
      ' flags whether the pooled verdict would FLIP. Deterministic. Files: (1) migration 0069_living-evidence.sql' +
      ' (idempotent): living_evidence_monitors(id uuid pk default gen_random_uuid(), org_id uuid not null' +
      ' references orgs(id) on delete cascade, topic text not null, query text, baseline jsonb, last_checked_at' +
      ' timestamptz, created_by uuid, created_at timestamptz default now()) + living_evidence_events(id uuid pk,' +
      ' monitor_id uuid references living_evidence_monitors(id) on delete cascade, kind text, detail jsonb,' +
      ' created_at timestamptz default now()); indexes (org_id, created_at desc), (monitor_id). (2)' +
      ' lib/livingEvidence/cumulativeMeta.ts — DETERMINISTIC cumulative meta-analysis: re-pool as each study is' +
      ' added in time order (reuse lib/metaAnalysis.ts metaAnalyze, do NOT edit it), report the running pooled' +
      ' estimate + when significance was first reached + whether a new study flips direction/significance. (3)' +
      ' lib/livingEvidence/monitor.ts — org-scoped repo (create/list monitors, record events) + assessLivingEvidence' +
      ' (given a baseline pool + a candidate new study, deterministically decide would_flip / strengthens /' +
      ' weakens / no_change). (4) SPECIALIZE backend/engines/pyalex/ IN PLACE: add pyalex/papertrail_citation_velocity.py' +
      ' (given a work id / DOI, compute citing-article counts per year = citation velocity, stdlib-only, + PAPERTRAIL.md).' +
      ' (5) app/api/evidence/living/route.ts (withOrg: GET list monitors; POST create) + app/api/evidence/living/' +
      'assess/route.ts (public compute: POST { studies[], candidate } -> cumulative + flip verdict). (6) console' +
      ' app/console/living-evidence/page.tsx + _components (create a monitor, view cumulative-evidence timeline +' +
      ' flip status). READ lib/metaAnalysis.ts, lib/trialSequential.ts, lib/api/handler.ts first.',
  },
  {
    key: 'fragility',
    body:
      'VERDICT-FRAGILITY ANALYSIS. How robust is a pooled verdict — would one more (or a few) event(s)/study change' +
      ' it? Deterministic, reuses existing engines without editing them. Files: (1) lib/evidenceFragility.ts —' +
      ' fragilityIndex(events2x2) (the classic Walsh fragility index: minimum number of event reassignments in the' +
      ' smaller arm to flip significance at p=0.05, via Fisher/normal test — pure math), plus requiredInformationSize' +
      ' + would-one-more-study-flip (reuse lib/trialSequential.ts RIS if exported; else compute inline) and a' +
      ' leave-one-out-derived robustness note (reuse lib/metaAnalysis.ts). Returns { fragilityIndex, interpretation,' +
      ' informationSizeMet, robustness } — deterministic, no LLM. (2) app/api/evidence/fragility/route.ts (public' +
      ' compute: POST either a 2x2 { a,b,c,d } for the fragility index or { studies[] } for meta-robustness).' +
      ' (3) app/console/fragility/page.tsx + _components (enter a 2x2 or studies -> fragility index + robustness).' +
      ' READ lib/trialSequential.ts, lib/metaAnalysis.ts, lib/biostats.ts first; do NOT edit them.',
  },
  {
    key: 'audit-export',
    body:
      'ENTERPRISE IMMUTABLE AUDIT EXPORT (Enterprise-tier-gated). Files: (1) lib/enterprise/auditExport.ts —' +
      ' assembleAuditExport(pool, orgId, { from?, to? }) that composes an immutable, verifiable export of the org' +
      ' audit chain (reuse lib/compliance/chain.ts verifyChain + the audit_chain rows) + a coverage summary +' +
      ' a top-level export_hash (sha256 over the canonical body via lib/compliance/hash.ts, excluding generated_at).' +
      ' Deterministic; every row traces; honest gaps listed; NO LLM. (2) app/api/enterprise/audit-export/route.ts —' +
      ' withOrg + requireRole("admin"); BEFORE assembling call requireFeature(getPool(), ctx.org.id, "audit_export")' +
      ' from lib/billing/tiers.ts and CATCH UpgradeRequired -> return fail(message, 402) with { feature, currentTier,' +
      ' requiredTiers } — THIS is the first real enforcement of the tier gate. ?format=json downloads. (3) console' +
      ' app/console/enterprise/audit-export/page.tsx + _components (date range -> assemble -> show chain-verify' +
      ' status + export hash + download; render a clear upgrade CTA on 402). READ lib/compliance/chain.ts,' +
      ' lib/compliance/hash.ts, lib/billing/tiers.ts (requireFeature/UpgradeRequired), lib/api/handler.ts first; do NOT edit them.',
  },
  {
    key: 'governance',
    body:
      'DATA GOVERNANCE — DSAR export + legal hold (enterprise/compliance). Files: (1) migration 0070_data-governance.sql' +
      ' (idempotent): legal_holds(id uuid pk default gen_random_uuid(), org_id uuid not null references orgs(id) on' +
      ' delete cascade, subject text not null, reason text, active boolean not null default true, placed_by uuid,' +
      ' placed_at timestamptz default now(), released_at timestamptz) + index (org_id, active). (2)' +
      ' lib/governance/legalHold.ts — org-scoped place/release/list holds; isUnderLegalHold(pool, orgId, subject)' +
      ' (used to BLOCK retention purge for held subjects — export a predicate the retention worker can consult).' +
      ' (3) lib/governance/dsar.ts — assembleDsarExport(pool, orgId, { subjectEmail }) that gathers, org-scoped, the' +
      ' data PaperTrail holds about a data subject (their user row if a member, memberships, audit_log entries they' +
      ' authored, api keys they own) into a structured DSAR package (counts + records, NEVER secrets/hashes' +
      ' verbatim). Deterministic, parameterized SQL. (4) app/api/governance/legal-hold/route.ts (withOrg admin: GET' +
      ' list, POST place, DELETE release) + app/api/governance/dsar/route.ts (withOrg admin: POST { subjectEmail } ->' +
      ' DSAR package; ?format=json download). (5) console app/console/governance/data/page.tsx + _components (place/' +
      'release holds + run a DSAR export). READ lib/governance/*, lib/audit.ts, db/migrations/0001_foundation.sql,' +
      ' lib/api/handler.ts first; additive only.',
  },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['group', 'filesCreated'],
  properties: {
    group: { type: 'string' },
    filesCreated: { type: 'array', items: { type: 'string' } },
    filesEdited: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    followups: { type: 'array', items: { type: 'string' } },
  },
}

phase('Build')
const built = (await parallel(
  GROUPS.map((g) => () =>
    agent(
      [
        'Build ONE PaperTrail feature (enterprise/evidence depth): ' + g.key + '.',
        '',
        CONTRACT,
        '',
        'YOUR PART:',
        g.body,
        '',
        'Ship complete, working, typed code (no TODOs, no any). Do NOT run npm/tsc. Edit ONLY files your part owns;',
        'edits to existing core files must be surgical + additive. Return files created + edited.',
      ].join('\n'),
      { label: 'build:' + g.key, phase: 'Build', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review the PaperTrail enterprise+evidence build. READ lib/livingEvidence/*,',
    'app/api/evidence/living*, lib/evidenceFragility.ts, app/api/evidence/fragility, lib/enterprise/auditExport.ts,',
    'app/api/enterprise/audit-export, lib/governance/dsar.ts, lib/governance/legalHold.ts, app/api/governance/dsar,',
    'app/api/governance/legal-hold, db/migrations/0069_living-evidence.sql, db/migrations/0070_data-governance.sql,',
    'the new console pages, and backend/engines/pyalex specialization. Check: NO LLM in any numeric/verdict/scoring',
    'path; org-scoped queries filter org_id (no cross-tenant leak); withOrg + requireRole on org routes; the',
    'audit-export route actually calls requireFeature and maps UpgradeRequired -> 402; migrations idempotent +',
    'uniquely numbered (0069, 0070); no Date.now in any content hash; DSAR never returns secrets/hashes verbatim;',
    'fragility index math is correct + deterministic; routes never log sensitive text; obvious TypeScript build',
    'risks. Report concrete issues with file + fix.',
  ].join('\n'),
  { label: 'verify:ee', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('Enterprise+evidence built: ' + built.length + ' features; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }

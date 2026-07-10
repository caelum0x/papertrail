export const meta = {
  name: 'round9',
  description: 'PaperTrail round 9: consolidation + hardening — a security sweep of all new public/org routes, UI consolidation of the duplicated study-editor/report-view, and DB indexes for the new query paths. One continuous run, then authoritative verify.',
  whenToUse: 'After the feature-complete evidence platform: sharpen and de-risk it — security fixes, less UI duplication, better query performance.',
  phases: [
    { title: 'Harden', detail: 'parallel disjoint: security fixes (routes/lib), UI consolidation (console/components), DB indexes (migration)' },
    { title: 'Verify', detail: 'authoritative tsc + full vitest + next build; fix any breakage' },
    { title: 'Report', detail: 'what changed + residual backlog' },
  ],
}

const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector, Vercel.
Deterministic clinical-claim verification platform. MOAT = deterministic engine, NO LLM in the
numeric loop. Over 8 build rounds it gained: meta-analysis, survival (KM/log-rank/Cox), network
meta (Bucher), meta-regression, continuous-outcome meta, subgroup, publication bias +
trim-and-fill, GRADE + risk-of-bias, absolute effects, an evidence report (+ batch, persistence,
workbench, HTML/CSV export), auto-synthesis, live ingestion, an end-to-end evidence pipeline,
analytics, cron/health, and CI. Many public compute routes under app/api and org-scoped routes
via withOrg.

Conventions: public compute routes mirror app/api/verify/route.ts (nodejs runtime, rate-limited
via lib/rateLimit, success/data/error envelope via lib/api/response ok/fail, sanitize claim text
via lib/api/claimInput, never log claim text). Org-scoped routes use withOrg (ctx.org.id) +
requireRole for mutations + writeAudit; every query has org_id as the FIRST predicate; never
trust a client-supplied org_id. Parameterized SQL only. Small focused files. Immutability.`

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['area', 'filesEdited', 'summary', 'checksPass'],
  properties: {
    area: { type: 'string' }, filesEdited: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }, checksPass: { type: 'boolean' },
    findingsFixed: { type: 'array', items: { type: 'string' } }, residual: { type: 'array', items: { type: 'string' } },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tscPass', 'testsPass', 'buildPass', 'testTotals', 'filesEdited', 'notes'],
  properties: {
    tscPass: { type: 'boolean' }, testsPass: { type: 'boolean' }, buildPass: { type: 'boolean' },
    testTotals: { type: 'string' }, filesEdited: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}

// Directory-disjoint ownership so the three hardening agents cannot collide:
//   security -> app/api/** + lib/** (non-UI) ; ui -> app/console/** + components/** ; db -> db/**
const SPECS = [
  {
    key: 'security',
    label: 'harden:security',
    agentType: 'security-reviewer',
    prompt: REPO + `

SECURITY SWEEP + FIX across the API surface. Scope: app/api/**/route.ts and lib/** (NOT
app/console or components — another agent owns those; do not edit them). Audit every route added
across the 8 rounds plus auth/RBAC, then FIX real issues with minimal, behavior-preserving diffs
(do NOT change function signatures the UI depends on). Check for:
- public routes missing rate limiting or a try/catch user-visible fallback;
- org-scoped routes trusting a client org_id, missing an org_id predicate, or missing requireRole
  on a mutation;
- any LLM/JSON.parse of untrusted input without Zod validation;
- SQL built by string concatenation (must be parameterized);
- claim text or secrets in logs; error messages leaking internals;
- missing input sanitization on public claim/query inputs (reuse lib/api/claimInput).
Fix the genuine ones. Then run npx tsc --noEmit and npx vitest run. Report filesEdited,
findingsFixed, residual (things worth a follow-up but out of safe scope), and checksPass.`,
  },
  {
    key: 'ui',
    label: 'harden:ui-consolidation',
    prompt: REPO + `

UI CONSOLIDATION. Scope: app/console/** and components/** ONLY (do NOT edit app/api or lib —
another agent owns those). The pages app/console/synthesis, app/console/evidence-report, and
app/console/workbench each re-implement a studies editor (add/remove rows: label, measure,
point, ci_lower, ci_upper) and an evidence-report renderer. Extract the shared pieces into
reusable components (e.g. components/synthesis/StudyEditor.tsx and
components/synthesis/EvidenceReportView.tsx — or extend existing shared ones) and refactor the
three pages to use them, REMOVING the duplication without changing behavior or visuals. Keep the
house Tailwind style. Do not break loading/error states. Then run npx tsc --noEmit.
Report filesEdited, findingsFixed (duplication removed), residual, and checksPass.`,
  },
  {
    key: 'db',
    label: 'harden:db-indexes',
    prompt: REPO + `

DB PERFORMANCE. Scope: db/** ONLY (plus you may READ lib/** query files for the access patterns;
do not edit them). Add a new migration db/migrations/0050_evidence-indexes.sql (READ
db/migrations/0001_foundation.sql and a recent migration for the house style and to confirm the
exact table/column names) adding indexes that match the NEW query patterns from rounds 5-8:
- sources lookups by (source_type, external_id) if not already uniquely indexed, and any
  frequent filter used by lib/queries/sources.ts / lib/ingest/searchAndCache.ts;
- evidence_reports: confirm the (org_id, created_at desc) index exists (from 0049); add any
  additional index the analytics group-by queries (by certainty, by verdict, per-month) would
  benefit from, e.g. (org_id, certainty) / (org_id, verdict), IF the columns exist.
Use CREATE INDEX IF NOT EXISTS, correct real column names only (do not invent columns), and add
a comment explaining each index. Report filesEdited and checksPass (migration parses as SQL).`,
  },
]

// PHASE 1 — HARDEN (parallel, directory-disjoint)
phase('Harden')
log('Round 9: security sweep, UI consolidation, and DB indexing in parallel (directory-disjoint)…')
const results = await parallel(
  SPECS.map((spec) => () =>
    agent(spec.prompt, {
      label: spec.label, phase: 'Harden', schema: RESULT_SCHEMA, effort: 'high',
      ...(spec.agentType ? { agentType: spec.agentType } : {}),
    }).then((r) => ({ key: spec.key, result: r }))
  )
)
const done = results.filter(Boolean)
log('Harden: ' + done.filter((d) => d.result?.checksPass).length + '/' + done.length + ' areas reported green.')

// PHASE 2 — VERIFY (authoritative, single agent, after all edits land)
phase('Verify')
log('Authoritative verification: tsc + full vitest + next build…')
const verify = await agent(
  REPO + `

AUTHORITATIVELY VERIFY the whole repo after this round's hardening edits. Run, in order:
1. npx tsc --noEmit
2. npx vitest run
3. npm run build
Report tscPass, testsPass (with testTotals like "N passed / M skipped"), buildPass, and notes.
If anything is RED, fix it with a minimal correct edit (the hardening agents may have left a
type error, a broken import from the UI refactor, or a test asserting a changed message) and
re-run until green — but NEVER weaken a correct test or delete a security fix to make it pass.
List every file you edited. Be honest about any residual red.`,
  { label: 'verify:authoritative', phase: 'Verify', effort: 'high', schema: VERIFY_SCHEMA }
)

// PHASE 3 — REPORT
phase('Report')
return {
  round: 9,
  areas: done.map((d) => ({
    area: d.key, filesEdited: d.result?.filesEdited || [], checksPass: d.result?.checksPass ?? null,
    findingsFixed: d.result?.findingsFixed || [], residual: d.result?.residual || [], summary: d.result?.summary || '',
  })),
  verify,
}

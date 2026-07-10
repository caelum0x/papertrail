export const meta = {
  name: 'round8',
  description: 'PaperTrail round 8: the end-to-end evidence spine — live source ingestion (search + cache), a claim->find sources->synthesize->certainty pipeline, and org analytics over saved reports. One continuous run with self-integration and hardening.',
  whenToUse: 'Make PaperTrail usable end-to-end: enter a claim, auto-find and cache primary sources, synthesize the evidence, and rate certainty — plus analytics over saved reports.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint builds: live ingestion, end-to-end evidence pipeline, evidence analytics' },
    { title: 'Verify', detail: 'adversarial review of caching correctness + pipeline safety' },
    { title: 'Chain', detail: 'wire the pipeline into the Workbench + analytics nav + tsc/tests' },
    { title: 'Harden', detail: 'discovery-driven fixes on shared files' },
    { title: 'Report', detail: 'results + backlog for the next round' },
  ],
}

const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector, Vercel.
Verifies clinical-trial efficacy claims vs primary sources. MOAT = DETERMINISTIC engine, NO
LLM IN THE NUMERIC LOOP.

Conventions: pure/immutable oracle-tested numeric logic; reuse lib/stats/distributions.
Zod-validate boundary input. PUBLIC compute routes mirror app/api/verify/route.ts (nodejs
runtime, rate-limited via lib/rateLimit, success/data/error envelope via lib/api/response
ok/fail, never log claim text). ORG-scoped routes use withOrg (ctx.org.id) + parsePagination
+ writeAudit + requireRole. CRITICAL caching rule (CLAUDE.md): cache EVERYTHING fetched from
PubMed/ClinicalTrials.gov in the sources table; NEVER re-fetch what is already cached — the
demo must not depend on live API latency. If retrieval finds no confident match, prefer an
honest 'no_support_found' over a forced low-confidence match.

Existing building blocks (READ; DO NOT EDIT unless you own the file this round):
  lib/sources/pubmed.ts + lib/sources/clinicaltrials.ts (fetch/parse primary sources),
  lib/queries/sources.ts (cached-source access + how rows are inserted/looked up),
  lib/agents/retrievalAgent.ts (semantic retrieval over cached sources; embeddings via
    lib/embeddings.ts), lib/autoSynthesis.ts (extractStudyFromSource, autoSynthesize),
  lib/evidenceReport.ts (buildEvidenceReport), lib/evidenceReports/repository.ts (saved
    reports; EvidenceReportRecord), lib/db.ts getPool.

PRIORITY (user directive): FOCUS ON PRODUCT CODE — engines, API, UI, pipeline wiring — not
tests. Per new module write at MOST one minimal test (mock network/DB). Bulk of effort on code.`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'filesWritten', 'summary', 'testsPassing'],
  properties: {
    vertical: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' }, testsPassing: { type: 'boolean' },
    publicExports: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'numericallyCorrect', 'confidence', 'issues'],
  properties: {
    vertical: { type: 'string' }, numericallyCorrect: { type: 'boolean' }, confidence: { type: 'number' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const RESERVED = [
  'lib/evidenceReport.ts', 'lib/autoSynthesis.ts', 'lib/metaAnalysis.ts', 'lib/stats/distributions.ts',
  'lib/evidenceReports/repository.ts', 'lib/queries/sources.ts', 'lib/sources/pubmed.ts',
  'lib/sources/clinicaltrials.ts', 'app/console/layout.tsx', 'app/api/verify/route.ts',
  'lib/ingest/searchAndCache.ts', 'lib/evidencePipeline.ts',
]

const BUILD_SPECS = [
  {
    key: 'ingestion',
    label: 'build:live-ingestion',
    prompt: REPO + `

BUILD live SOURCE INGESTION with strict caching — search PubMed + ClinicalTrials.gov for a
query and CACHE the results into the sources table, so downstream synthesis works on real
literature but never re-fetches. Own ONLY:
- lib/ingest/searchAndCache.ts (new)
- app/api/ingest/route.ts (new)
- tests/searchAndCache.test.ts (new, mock network + db)

lib/ingest/searchAndCache.ts exports searchAndCache(pool, { query, limit }) that:
  1. Looks up already-cached sources for the query FIRST (dedupe by external_id + source_type);
  2. Only fetches NEW ids from PubMed/ClinicalTrials via the existing lib/sources fetchers;
  3. Inserts new rows into the sources table using the SAME insert path used elsewhere (READ
     lib/queries/sources.ts / lib/agents/retrievalAgent.ts to reuse the existing upsert; do not
     invent a new schema), computing embeddings via lib/embeddings.ts only for new rows;
  4. Returns { cachedSourceIds, fetchedCount, reusedCount }. Structure it so the fetchers and
     embed function are injectable/mvockable for the test (pass them in or isolate them).
Never log claim text. Pure where possible; the DB/network effects are confined to this module.

app/api/ingest/route.ts: POST { query, limit? }. If sources are org-scoped, use withOrg; else
mirror the public source routes. Rate-limited, envelope, Zod-validated.

tests: ONE test with a MOCK fetcher + in-memory/mock pool asserting that already-cached ids are
reused (fetcher NOT called for them) and new ids are inserted once. Run ONLY
` + "`npx vitest run tests/searchAndCache.test.ts`" + `.`,
  },
  {
    key: 'pipeline',
    label: 'build:evidence-pipeline',
    prompt: REPO + `

BUILD the END-TO-END EVIDENCE PIPELINE — the product's core promise: a claim in, a full
evidence report out, having found the sources itself. Own ONLY:
- lib/evidencePipeline.ts (new)
- app/api/evidence-pipeline/route.ts (new)
- tests/evidencePipeline.test.ts (new, minimal; mock retrieval)

lib/evidencePipeline.ts exports runEvidencePipeline(pool, { claim, query?, limit? }) that:
  1. Retrieves candidate CACHED sources relevant to the claim/query — reuse
     lib/agents/retrievalAgent.ts (semantic search over cached sources). Do NOT put an LLM in
     any numeric step; retrieval/embedding is fine.
  2. Passes those source rows into autoSynthesize({ claim, sources }) (lib/autoSynthesis.ts) to
     deterministically extract effects and build the evidence report (meta-analysis -> pub-bias
     -> GRADE -> verdict).
  3. Returns { claim, usedSources:[{id,title,source_type}], skipped, report }. When fewer than 2
     usable sources are found, return an honest insufficient result (no_support_found spirit).
  Make retrieval injectable so the test can mock it (no live embeddings in the test).

app/api/evidence-pipeline/route.ts: public POST { claim, query?, limit? } (nodejs, rate-limited,
envelope, sanitize claim like /api/verify, never log claim text). Returns the pipeline result.

tests: ONE test injecting a mock retrieval that returns 2 fixture sources with registered_results
-> asserts a pooled report + usedSources; and a zero-source case -> insufficient. Run ONLY
` + "`npx vitest run tests/evidencePipeline.test.ts`" + `.`,
  },
  {
    key: 'analytics',
    label: 'build:evidence-analytics',
    prompt: REPO + `

BUILD ORG ANALYTICS over saved evidence reports — turn the persisted reports into an
at-a-glance view. Own ONLY:
- lib/evidenceReports/analytics.ts (new)
- app/api/analytics/evidence-reports/route.ts (new)
- app/console/analytics/evidence-reports/page.tsx (new, 'use client')

lib/evidenceReports/analytics.ts exports evidenceReportAnalytics(pool, { orgId }) returning
{ total, byCertainty: {high,moderate,low,very_low}, byVerdict: Record<string,number>,
recent: [{id, claim, certainty, verdict, createdAt}], perMonth: [{month, count}] }. EVERY query
is org-scoped (org_id first predicate). Read lib/evidenceReports/repository.ts for the table +
row shape; write plain aggregate SQL (count/group by). Pure data access, no mutation.

app/api/analytics/evidence-reports/route.ts: withOrg GET (any member), envelope. Uses ctx.org.id.

app/console/analytics/evidence-reports/page.tsx ('use client'): fetch the analytics endpoint and
render summary cards (total, certainty distribution as a small stacked bar, verdict breakdown)
and a recent-reports table linking to each. Mirror the house Tailwind style + loading/error
patterns of an existing analytics page (READ app/console/analytics/page.tsx). Keep <300 L.

tests: none required (UI + SQL). testsPassing=true, testCommand "n/a".`,
  },
]

// PHASE 1 — BUILD -> VERIFY
phase('Build')
log('Round 8: live ingestion, the end-to-end evidence pipeline, and evidence analytics in parallel…')
const built = await pipeline(
  BUILD_SPECS,
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { spec: spec.key, build: null, verdict: null }
    return agent(
      REPO + `

ADVERSARIALLY VERIFY the "` + spec.key + `" vertical. Files: ` + (build.filesWritten || []).join(', ') + `.
For ingestion: confirm it reuses cached sources and does NOT re-fetch already-cached ids
(the core caching rule), reuses the existing insert path (no schema drift), and confines
side effects. For pipeline: confirm retrieval is injectable/mocked in the test, NO LLM sits in
a numeric step, autoSynthesize is used for extraction, and the insufficient path is honest.
For analytics: confirm EVERY query is org-scoped (org_id first predicate) and the SQL is valid.
Put real correctness/security problems in issues as 'blocker'. Default numericallyCorrect=false
if you cannot independently confirm.`,
      { label: 'verify:' + spec.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ spec: spec.key, build, verdict }))
  }
)
const verticals = built.filter(Boolean)
const passed = verticals.filter((v) => v.verdict?.numericallyCorrect && v.build?.testsPassing !== false)
log('Build+Verify: ' + passed.length + '/' + verticals.length + ' verticals passed adversarial review.')

// PHASE 2 — CHAIN
phase('Chain')
log('Wiring the end-to-end pipeline into the Workbench + analytics nav + authoritative tsc/tests…')
const integration = await agent(
  REPO + `

INTEGRATE round 8 coherently and keep the app green.
1. In app/console/workbench/page.tsx add an "Auto-find & synthesize from a claim" mode: a claim
   box + optional query that POSTs to /api/evidence-pipeline and renders the returned evidence
   report (reuse the existing report rendering + ForestPlot) plus the list of sources it used
   and which it skipped. Keep the existing manual + source-picker modes.
2. Nav: add { href: "/console/analytics/evidence-reports", label: "Evidence Analytics" } to the
   "Review & report" section of NAV_SECTIONS in app/console/layout.tsx.
3. Run npx tsc --noEmit and fix type errors in this round's files; run npx vitest run and fix
   genuine breakage (fix wrong CODE, not correct tests).
Report: tsc pass/fail, vitest counts, and every file edited. Be honest if anything is red.`,
  { label: 'integrate:pipeline+nav', phase: 'Chain', effort: 'high' }
)

// PHASE 3 — HARDEN
phase('Harden')
log('Hardening remaining backlog…')
const harden = await agent(
  REPO + `

HARDEN with MINIMAL correct edits. Do NOT touch owner-reserved files: ` + RESERVED.join(', ') + `.
Targets (address what genuinely applies; do not invent changes):
1. Any public route missing rate limiting / try-catch, or LLM JSON parsed without Zod.
2. Any org-scoped route trusting client org_id or missing an org_id predicate / requireRole on
   mutations.
3. Confirm the new ingestion/pipeline routes sanitize the claim and never log claim text.
Run npx tsc --noEmit and npx vitest run; report results honestly with the exact files edited.
If clean on a target, say so.`,
  { label: 'harden:api', phase: 'Harden', effort: 'high' }
)

// PHASE 4 — REPORT
phase('Report')
return {
  round: 8,
  verticals: verticals.map((v) => ({
    vertical: v.spec, files: v.build?.filesWritten || [], exports: v.build?.publicExports || [],
    numericallyCorrect: v.verdict?.numericallyCorrect ?? null, confidence: v.verdict?.confidence ?? null,
    blockers: (v.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: v.build?.summary || '',
  })),
  integrationReport: integration,
  hardenReport: harden,
  passed: passed.length,
  total: verticals.length,
}

export const meta = {
  name: 'round5',
  description: 'PaperTrail round 5: continuous-outcome meta-analysis (MD + Hedges g SMD), org-scoped evidence-report PERSISTENCE (migration + repository + API), and a unified Evidence Workbench UI — one continuous run with self-integration and hardening.',
  whenToUse: 'Broaden PaperTrail from ratio-only stateless engines to continuous outcomes + saved, multi-tenant evidence reports with a unified workbench.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint builds: continuous meta, persistence backend, workbench UI' },
    { title: 'Verify', detail: 'adversarial review of the new engine + persistence + UI' },
    { title: 'Chain', detail: 'wire workbench save->persistence, nav, authoritative tsc + tests' },
    { title: 'Harden', detail: 'discovery-driven fixes on shared files' },
    { title: 'Report', detail: 'results + backlog for the next round' },
  ],
}

const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector (pg Pool via
lib/db getPool), Anthropic Claude. Verifies clinical-trial efficacy claims vs primary
sources. MOAT = DETERMINISTIC engine, NO LLM IN THE NUMERIC LOOP.

Conventions: pure/immutable oracle-tested biostatistics; reuse lib/stats/distributions
(normalQuantile, ciZ, studentTCdf, studentTInverse, chiSquareSurvival, incompleteBeta) —
never reimplement. Zod-validate boundary input. Two API styles:
 - PUBLIC compute routes (mirror app/api/verify/route.ts): nodejs runtime, rate-limited via
   lib/rateLimit, {success,data,error} envelope via lib/api/response (ok/fail), never log claim text.
 - ORG-SCOPED routes (mirror app/api/billing/subscription/route.ts + app/api/signatures/route.ts):
   wrap with withOrg from lib/api/handler (ctx.org.id, ctx.user, ctx.role), every query filtered
   by org_id, use ok/created/fail, writeAudit from lib/audit for mutations, requireRole from
   lib/authz/rbac where appropriate, parsePagination for lists.
Repositories follow lib/*/repository.ts (READ app/api/billing/lib/repository.ts or
lib/signatures/repository.ts for the row-mapping + org-scoping pattern). Migrations live in
db/migrations/NNNN_name.sql applied in order; READ db/migrations/0001_foundation.sql and a
recent one for the house SQL style (org_id uuid FK, created_at timestamptz default now(),
indexes). Small files (<400 L).

Existing engines (READ; DO NOT EDIT unless you own the file this round):
  lib/metaAnalysis.ts (metaAnalyze(inputs:StudyEffectInput[])->MetaAnalysisResult; ratio only),
  lib/evidenceReport.ts (buildEvidenceReport({claim,studies,baselineRisk?})->composite;
    EvidenceReportRequestSchema), lib/grade.ts, lib/absoluteEffects.ts, lib/stats/distributions.ts.

PRIORITY (user directive): FOCUS ON PRODUCT CODE — engines, API, UI, DB wiring — not tests.
Per new engine write at MOST one minimal oracle sanity test. Bulk of effort on real code.`

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
  'lib/metaAnalysis.ts', 'lib/synthesisVerification.ts', 'lib/grade.ts', 'lib/evidenceReport.ts',
  'lib/absoluteEffects.ts', 'lib/stats/distributions.ts', 'lib/continuousMeta.ts',
  'lib/evidenceReports/repository.ts', 'app/console/layout.tsx', 'lib/db.ts',
]

const BUILD_SPECS = [
  {
    key: 'continuousMeta',
    label: 'build:continuous-meta',
    prompt: `${REPO}

BUILD deterministic CONTINUOUS-OUTCOME meta-analysis — the biggest remaining gap (the engine
is ratio-only today; many trials report continuous endpoints like blood-pressure or pain-score
change). Own ONLY:
- lib/continuousMeta.ts (new)
- app/api/continuous-meta/route.ts (new)
- tests/continuousMeta.test.ts (new, minimal oracle)

lib/continuousMeta.ts (pure) exports:
1. meanDifference(study) from { meanT, sdT, nT, meanC, sdC, nC } -> { md, se, variance,
   ciLower, ciUpper } (MD = meanT-meanC, SE = sqrt(sdT^2/nT + sdC^2/nC), Welch-style).
2. hedgesG(study) -> standardized mean difference with the small-sample correction J =
   1 - 3/(4*(nT+nC-2)-1); pooled SD = sqrt(((nT-1)sdT^2+(nC-1)sdC^2)/(nT+nC-2)); d = MD/pooledSD;
   g = J*d; Var(g) = J^2 * ( (nT+nC)/(nT*nC) + d^2/(2*(nT+nC-2)) ). Return { g, se, variance,
   ciLower, ciUpper }.
3. poolContinuous(studies, { measure: 'MD' | 'SMD' }) -> inverse-variance fixed + DerSimonian-
   Laird random-effects pool on the MD or Hedges-g scale (NULL of 0, not 1 — these are
   differences), with Q, df, I^2, tau^2, and 95% CIs. Reuse the SAME DL math shape as
   lib/metaAnalysis.ts but for a difference measure. Return per-study weights too.
Export a Zod schema locally. app/api/continuous-meta/route.ts: public POST, rate-limited, envelope.

tests: ONE oracle test — a small fixture where MD, Hedges g (with J correction), and the pooled
random-effects estimate + I^2 are hand-checkable against reference values. Run ONLY
\`npx vitest run tests/continuousMeta.test.ts\`.`,
  },
  {
    key: 'persistence',
    label: 'build:evidence-report-persistence',
    prompt: `${REPO}

BUILD org-scoped PERSISTENCE for evidence reports so the new science is a real multi-tenant
feature, not a stateless endpoint. Own ONLY these NEW files:
- db/migrations/0049_evidence-reports.sql
- lib/evidenceReports/types.ts
- lib/evidenceReports/schemas.ts
- lib/evidenceReports/repository.ts
- app/api/evidence-reports/route.ts        (GET list [paginated, org-scoped], POST create)
- app/api/evidence-reports/[id]/route.ts   (GET one, DELETE)

db/migrations/0049_evidence-reports.sql: a table evidence_reports (id uuid pk default
gen_random_uuid(), org_id uuid not null references orgs(id) on delete cascade, project_id uuid
null, created_by uuid null, claim text not null, verdict text, certainty text, pooled jsonb,
report jsonb not null, created_at timestamptz not null default now()) + an index on
(org_id, created_at desc). READ db/migrations/0001_foundation.sql for the exact house style
(FK naming, IF NOT EXISTS). Do not reference tables that may not exist besides orgs.

lib/evidenceReports/repository.ts: pure data access, EVERY method org-scoped (org_id is the
first WHERE predicate) — createReport, listReports (paginated), getReport(id), deleteReport(id).
Map rows to a typed EvidenceReportRecord (camelCase). Mirror lib/signatures/repository.ts style.

Routes use withOrg (ctx.org.id), ok/created/fail, parsePagination for the list, writeAudit on
create + delete, and validate the POST body with a Zod schema (it stores a claim + the composite
report object the caller already computed — validate it is an object; do not recompute here).
Never trust client org_id — always ctx.org.id.

VERIFY your files type-check in isolation; full tsc runs later. Report filesWritten,
publicExports. testsPassing may be true with a "n/a (backend/migration)" note.`,
  },
  {
    key: 'workbench',
    label: 'build:evidence-workbench',
    prompt: `${REPO}

BUILD a unified EVIDENCE WORKBENCH console page — one screen where a reviewer enters a claim +
a set of trials and sees the WHOLE deterministic stack at once (meta-analysis pooled estimate,
GRADE certainty, publication-bias, synthesis verdict, absolute effects), reusing existing
public endpoints. Own ONLY these NEW files:
- app/console/workbench/page.tsx            ('use client')
- app/console/workbench/_components/*        (as needed)
Do NOT edit app/console/layout.tsx (nav wired later). Do NOT build the save button yet (the
persistence API is being built in parallel; save is wired in the integration phase).

The page POSTs to /api/evidence-report (existing) with { claim, studies, baselineRisk? } and
renders: the certainty badge, synthesis verdict + rationale, pooled fixed & random stats with
I^2/tau^2, publication-bias (Egger) note, absolute effects (ARR/NNT/events-per-1000) when a
baseline risk is entered, and REUSE components/synthesis/ForestPlot.tsx for the plot. Include a
studies editor (add/remove rows: label, measure, point, ci_lower, ci_upper) and a claim box.
Mirror the house Tailwind style (bg-paper, text-ink, accent) and the loading/error patterns in
app/console/synthesis/page.tsx (READ it). Add an "Export" link/button that opens
/api/evidence-report/export for the current inputs. Keep files <400 L.

Report filesWritten and a one-line summary. testsPassing=true, testCommand "n/a (UI)".`,
  },
]

// PHASE 1 — BUILD -> VERIFY
phase('Build')
log('Round 5: continuous-outcome meta, evidence-report persistence, and the Evidence Workbench in parallel…')
const built = await pipeline(
  BUILD_SPECS,
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { spec: spec.key, build: null, verdict: null }
    return agent(
      `${REPO}\n\nADVERSARIALLY VERIFY the "${spec.key}" vertical. Files: ${(build.filesWritten || []).join(', ')}.
For continuousMeta: recompute MD, Hedges g (with the J correction), and the pooled DL estimate
by hand and check the numbers; confirm the null is 0 (difference), not 1. For persistence:
confirm EVERY query is org-scoped (org_id first predicate), no client-supplied org_id is trusted,
mutations writeAudit, and the migration matches the house style. For workbench: confirm it only
reads existing endpoints, escapes/handles errors, and puts no LLM in a numeric path. Run any test
present. Default numericallyCorrect=false (or, for non-numeric verticals, treat it as
"correct-and-safe=false") if you cannot independently confirm; put security/scoping problems in
issues as 'blocker'.`,
      { label: `verify:${spec.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ spec: spec.key, build, verdict }))
  }
)
const verticals = built.filter(Boolean)
const passed = verticals.filter((v) => v.verdict?.numericallyCorrect && v.build?.testsPassing !== false)
log(`Build+Verify: ${passed.length}/${verticals.length} verticals passed adversarial review.`)

// PHASE 2 — CHAIN
phase('Chain')
log('Wiring workbench save->persistence, nav, and running authoritative tsc/tests…')
const integration = await agent(
  `${REPO}\n\nINTEGRATE round 5 coherently and keep the app green.
1. Wire "Save report" in app/console/workbench/page.tsx (and/or its _components): after a report
   is computed, a Save button POSTs { claim, verdict, certainty, pooled, report } to
   /api/evidence-reports (the org-scoped route built this round) and shows a saved confirmation +
   a link to a saved-reports list. Handle 401/403/error states.
2. Add a saved-reports list page app/console/evidence-reports/page.tsx that GETs
   /api/evidence-reports (paginated) and links each to a detail view, OR add a "Saved reports"
   panel to the workbench — your call, keep it simple and consistent with the house UI.
3. Nav: add { href: "/console/workbench", label: "Evidence Workbench" } to the "Research" section
   of NAV_SECTIONS in app/console/layout.tsx (right after "Evidence Report").
4. Run \`npx tsc --noEmit\` and fix type errors in this round's files; run \`npx vitest run\` and fix
   genuine breakage (fix wrong CODE, not correct tests).
Report: tsc pass/fail, vitest counts, and every file edited. Be honest if anything is red.`,
  { label: 'integrate:workbench+nav', phase: 'Chain', effort: 'high' }
)

// PHASE 3 — HARDEN
phase('Harden')
log('Hardening remaining backlog…')
const harden = await agent(
  `${REPO}\n\nHARDEN with MINIMAL correct edits. Do NOT touch owner-reserved files:
${RESERVED.join(', ')}.
Targets (address what genuinely applies; do not invent changes):
1. Any org-scoped route that trusts a client-supplied org_id or is missing an org_id predicate.
2. Any public API route missing try/catch with a user-visible fallback, or LLM JSON parsed
   without Zod validation, or a numeric public route not rate-limited.
3. Confirm the new db/migrations/0049 file is idempotent-safe (IF NOT EXISTS) and ordered.
Run \`npx tsc --noEmit\` and \`npx vitest run\`; report results honestly with the exact files
edited. If clean on a target, say so.`,
  { label: 'harden:scoping', phase: 'Harden', effort: 'high' }
)

// PHASE 4 — REPORT
phase('Report')
return {
  round: 5,
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

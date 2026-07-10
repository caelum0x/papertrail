export const meta = {
  name: 'round7',
  description: 'PaperTrail round 7: deterministic risk-of-bias assessment (completing automated GRADE), CI + deploy readiness (GitHub Actions, CHANGELOG, env audit), and a cached-source picker for auto-synthesis — one continuous run with self-integration and hardening.',
  whenToUse: 'Complete automated GRADE with risk-of-bias, make the repo CI/deploy-ready, and give auto-synthesis a real source picker.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint builds: risk-of-bias engine, CI/deploy readiness, source picker' },
    { title: 'Verify', detail: 'adversarial review of RoB logic + CI correctness' },
    { title: 'Chain', detail: 'wire RoB into the evidence report + source picker into workbench + nav + tsc/tests' },
    { title: 'Harden', detail: 'discovery-driven fixes on shared files' },
    { title: 'Report', detail: 'results + backlog for the next round' },
  ],
}

const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector, Vercel deploy.
Verifies clinical-trial efficacy claims vs primary sources. MOAT = DETERMINISTIC engine, NO
LLM IN THE NUMERIC LOOP.

Conventions: pure/immutable oracle-tested logic; reuse lib/stats/distributions — never
reimplement. Zod-validate boundary input. PUBLIC compute routes mirror app/api/verify/route.ts
(nodejs runtime, rate-limited via lib/rateLimit, success/data/error envelope via lib/api/response
ok/fail, never log claim text). Commands: npm run build, npm test (vitest), npx tsc --noEmit,
npm run db:migrate. Tests run against tests/fixtures; live-API tests skip without ANTHROPIC_API_KEY.

Existing engines (READ; DO NOT EDIT unless you own the file this round):
  lib/grade.ts (gradeCertainty(input) — input has riskOfBiasSteps/indirectnessSteps/
    publicationBiasSteps caller-supplied 0..2 each; the numeric domains are auto-derived),
  lib/evidenceReport.ts (buildEvidenceReport({claim,studies,baselineRisk?})),
  lib/autoSynthesis.ts (extractStudyFromSource, autoSynthesize),
  lib/queries/sources.ts (cached-source access), app/api/search/route.ts + app/api/sources
  (how sources are listed/searched). components/synthesis/ForestPlot.tsx.

PRIORITY (user directive): FOCUS ON PRODUCT CODE — engines, API, UI, CI/infra — not tests.
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
  'lib/grade.ts', 'lib/evidenceReport.ts', 'lib/autoSynthesis.ts', 'lib/metaAnalysis.ts',
  'lib/stats/distributions.ts', 'lib/riskOfBias.ts', 'app/console/layout.tsx',
  'package.json', 'vercel.json',
]

const BUILD_SPECS = [
  {
    key: 'riskOfBias',
    label: 'build:risk-of-bias',
    prompt: REPO + `

BUILD a deterministic RISK-OF-BIAS assessment that COMPLETES automated GRADE — today
gradeCertainty takes a caller-supplied riskOfBiasSteps, but nothing derives it. Own ONLY:
- lib/riskOfBias.ts (new)
- app/api/risk-of-bias/route.ts (new)
- tests/riskOfBias.test.ts (new, minimal oracle)

lib/riskOfBias.ts (pure) exports assessRiskOfBias(trial) where trial captures the standard
Cochrane RoB 2 style domains as explicit booleans/enums a reviewer can answer from a paper:
randomization/allocation concealment, blinding (participants/personnel/outcome), incomplete
outcome data (attrition/ITT), selective reporting, and a few pragmatic flags (small sample,
early stopping for benefit, industry-only funding). Map each domain to low | some_concerns |
high, then reduce the set to an overall judgement AND a GRADE downgrade step count (0/1/2):
e.g. any 'high' in a critical domain -> at least 1 step; multiple 'high' -> 2 steps. Return
{ domains: [{name, judgement, reason}], overall: 'low'|'some_concerns'|'high', gradeSteps }.
Document each rule in a comment. Export a Zod schema locally.

app/api/risk-of-bias/route.ts: public POST, rate-limited, envelope, Zod-validated.

tests: ONE table-driven oracle test — a clean trial -> low / 0 steps; one high critical
domain -> some_concerns/high with >=1 step; multiple high -> 2 steps. Run ONLY
` + "`npx vitest run tests/riskOfBias.test.ts`" + `.`,
  },
  {
    key: 'ciReadiness',
    label: 'build:ci-deploy-readiness',
    prompt: REPO + `

MAKE THE REPO CI + DEPLOY READY (the CLAUDE.md Definition of Done wants CI passing before a
demo). Own ONLY these NEW files (do not edit package.json — READ it for the script names):
- .github/workflows/ci.yml (new)
- CHANGELOG.md (new)
- docs/deploy.md (new)

.github/workflows/ci.yml: a GitHub Actions workflow triggered on push + pull_request to main,
Node 20, that runs: npm ci, npx tsc --noEmit, npm test, and npm run build. Use a dummy
DATABASE_URL / secrets via env so the build's static generation does not hard-fail (the app's
data fetches already tolerate a missing DB at build). Cache npm. Keep it one job, clear steps.
Do NOT invent script names — use the ones in package.json (build, test, lint if present).

CHANGELOG.md: a Keep-a-Changelog style file with an "Unreleased" section summarizing the
evidence-synthesis platform added across recent work (meta-analysis, survival/KM/Cox, network
meta, meta-regression, continuous outcomes, subgroup, publication bias + trim-and-fill, GRADE
+ risk-of-bias, absolute effects, evidence report + persistence + workbench + export,
auto-synthesis, cron/health). Group under Added/Changed/Fixed. Be accurate, not aspirational.

docs/deploy.md: a concise deploy guide — required env vars (READ .env.example), how the Vercel
cron + CRON_SECRET works (see vercel.json + app/api/cron/tick), running migrations
(npm run db:migrate), and the /api/health check. Tight and correct.

Report filesWritten. testsPassing=true, testCommand "n/a (CI/docs)".`,
  },
  {
    key: 'sourcePicker',
    label: 'build:source-picker',
    prompt: REPO + `

BUILD a cached-SOURCE PICKER so auto-synthesis is usable without hand-typing UUIDs. Own ONLY:
- components/sources/SourcePicker.tsx (new, 'use client')
- app/console/workbench/_components/SourceSearch.tsx (new, 'use client')

SourcePicker.tsx: a reusable control that searches cached sources (reuse the existing search/
sources API — READ app/api/search/route.ts and app/api/sources to see what is available; call
whichever returns cached PubMed/ClinicalTrials rows), shows results (title, type, external id),
and lets the user multi-select. Props: onChange(selectedSourceIds: string[]) and an optional
initial selection. Debounce the query, handle loading/empty/error, mirror the house Tailwind
style. Accessible (labels, keyboard).
SourceSearch.tsx: a thin workbench wrapper that composes SourcePicker and exposes the selected
IDs to the workbench page (the wiring into /api/auto-synthesis happens in the integration phase).

Do NOT edit app/console/workbench/page.tsx (integration phase wires it). Keep files <300 L.
Report filesWritten. testsPassing=true, testCommand "n/a (UI)".`,
  },
]

// PHASE 1 — BUILD -> VERIFY
phase('Build')
log('Round 7: risk-of-bias engine, CI/deploy readiness, and the source picker in parallel…')
const built = await pipeline(
  BUILD_SPECS,
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { spec: spec.key, build: null, verdict: null }
    return agent(
      REPO + `

ADVERSARIALLY VERIFY the "` + spec.key + `" vertical. Files: ` + (build.filesWritten || []).join(', ') + `.
For riskOfBias: confirm the domain->judgement->gradeSteps mapping is internally consistent,
documented, deterministic (no LLM), and clamps steps to 0..2; try to produce a contradictory
rating. For ciReadiness: confirm ci.yml only uses scripts that EXIST in package.json, the
workflow is valid YAML, and the build step will not hard-fail on a missing DB; CHANGELOG/deploy
docs must be accurate (no invented endpoints/vars). For sourcePicker: confirm it only calls
endpoints that EXIST and handles errors. Put real problems in issues as 'blocker'. Default
numericallyCorrect=false if you cannot independently confirm.`,
      { label: 'verify:' + spec.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ spec: spec.key, build, verdict }))
  }
)
const verticals = built.filter(Boolean)
const passed = verticals.filter((v) => v.verdict?.numericallyCorrect && v.build?.testsPassing !== false)
log('Build+Verify: ' + passed.length + '/' + verticals.length + ' verticals passed adversarial review.')

// PHASE 2 — CHAIN
phase('Chain')
log('Wiring risk-of-bias into the evidence report + source picker into the workbench + nav + tsc/tests…')
const integration = await agent(
  REPO + `

INTEGRATE round 7 coherently and keep the app green.
1. Wire risk-of-bias into the evidence pipeline: in the evidence-report request, accept an
   OPTIONAL riskOfBias assessment input (or per-study), run assessRiskOfBias, and pass its
   gradeSteps as riskOfBiasSteps into gradeCertainty via buildEvidenceReport. NOTE
   lib/evidenceReport.ts and lib/grade.ts are owner-reserved — do NOT edit them; instead add a
   thin adapter (e.g. lib/riskOfBiasAdapter.ts) and use it in the API route
   app/api/evidence-report/route.ts if that route is editable, OR expose the RoB result in the
   workbench UI so the user can feed the derived steps. Keep it strictly additive; never break
   existing fields/tests. If a clean wiring requires editing a reserved file, DO NOT — instead
   surface RoB in the workbench UI and note the deeper wiring as backlog.
2. Wire the source picker: in app/console/workbench/page.tsx add the SourceSearch component so
   the user can pick cached sources and run /api/auto-synthesis to populate studies.
3. Nav: no new top-level page expected; add one only if you created a standalone page.
4. Run npx tsc --noEmit and fix type errors in this round's files; run npx vitest run and fix
   genuine breakage (fix wrong CODE, not correct tests).
Report: tsc pass/fail, vitest counts, and every file edited. Be honest if anything is red.`,
  { label: 'integrate:rob+picker', phase: 'Chain', effort: 'high' }
)

// PHASE 3 — HARDEN
phase('Harden')
log('Hardening remaining backlog…')
const harden = await agent(
  REPO + `

HARDEN with MINIMAL correct edits. Do NOT touch owner-reserved files: ` + RESERVED.join(', ') + `.
Targets (address what genuinely applies; do not invent changes):
1. Any public route missing rate limiting / try-catch, or LLM JSON parsed without Zod.
2. Any org-scoped mutation route missing requireRole, or trusting client org_id.
3. Confirm every round-6/7 API route uses the shared envelope and never logs claim text.
Run npx tsc --noEmit and npx vitest run; report results honestly with the exact files edited.
If clean on a target, say so.`,
  { label: 'harden:api', phase: 'Harden', effort: 'high' }
)

// PHASE 4 — REPORT
phase('Report')
return {
  round: 7,
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

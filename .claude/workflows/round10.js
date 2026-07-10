export const meta = {
  name: 'round10',
  description: 'PaperTrail round 10: Trial Sequential Analysis (is the evidence conclusive?), dose-response meta-analysis, and living-evidence re-evaluation (re-run a saved report when new sources arrive). One continuous run with self-integration and hardening.',
  whenToUse: 'Deepen the moat with conclusiveness + dose-response, and make saved evidence reports living (auto re-evaluated).',
  phases: [
    { title: 'Build', detail: 'parallel disjoint builds: trial sequential analysis, dose-response meta, living re-evaluation' },
    { title: 'Verify', detail: 'adversarial numeric review of each engine + re-eval safety' },
    { title: 'Chain', detail: 'wire TSA + dose-response panels into the workbench + nav + tsc/tests' },
    { title: 'Harden', detail: 'discovery-driven fixes on shared files' },
    { title: 'Report', detail: 'results + backlog for the next round' },
  ],
}

const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector, Vercel.
Deterministic clinical-claim verification + evidence-synthesis platform. MOAT = deterministic
engine, NO LLM IN THE NUMERIC LOOP.

Conventions: pure/immutable oracle-tested numeric logic; reuse lib/stats/distributions
(normalQuantile, ciZ, studentTCdf, studentTInverse, chiSquareSurvival, incompleteBeta) — never
reimplement. Zod-validate boundary input. PUBLIC compute routes mirror app/api/verify/route.ts
(nodejs runtime, rate-limited via lib/rateLimit, success/data/error envelope via lib/api/response
ok/fail, never log claim text). ORG-scoped routes use withOrg (ctx.org.id) + requireRole on
mutations + writeAudit; every query has org_id as the FIRST predicate.

Existing building blocks (READ; DO NOT EDIT unless you own the file this round):
  lib/metaAnalysis.ts (metaAnalyze -> {random{logPoint,se,point,ciLower,ciUpper},heterogeneity
    {iSquared,tauSquared},k}), lib/evidencePipeline.ts (runEvidencePipeline(pool,{claim,query?})),
  lib/evidenceReports/repository.ts (getReport/listReports; EvidenceReportRecord with claim +
    report jsonb), lib/biostats.ts (riskRatioFromCounts), lib/effectSize.ts (claimedReductionPercent),
  components/synthesis/ForestPlot.tsx, app/console/workbench/page.tsx.

PRIORITY (user directive): FOCUS ON PRODUCT CODE — engines, API, UI, wiring — not tests. Per
new engine write at MOST one minimal oracle sanity test. Bulk of effort on real code.`

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
  'lib/metaAnalysis.ts', 'lib/evidencePipeline.ts', 'lib/evidenceReports/repository.ts',
  'lib/stats/distributions.ts', 'lib/trialSequential.ts', 'lib/doseResponse.ts',
  'app/console/layout.tsx',
]

const BUILD_SPECS = [
  {
    key: 'tsa',
    label: 'build:trial-sequential-analysis',
    prompt: REPO + `

BUILD deterministic TRIAL SEQUENTIAL ANALYSIS (TSA) — answers "is the pooled evidence
CONCLUSIVE, or is more data needed?", a question no generic checker answers. Own ONLY:
- lib/trialSequential.ts (new)
- app/api/trial-sequential/route.ts (new)
- tests/trialSequential.test.ts (new, minimal oracle)

lib/trialSequential.ts (pure) exports:
1. requiredInformationSize({ controlRisk, relativeRiskReduction, alpha, power, iSquared? }) ->
   the RIS (required number of participants) for a two-arm trial using the standard sample-size
   formula n = (z_alpha/2 + z_beta)^2 * (p1(1-p1)+p2(1-p2)) / (p1-p2)^2 * 2, with p2 =
   controlRisk*(1-RRR); optionally inflate by a heterogeneity/diversity factor 1/(1-I^2) when
   iSquared is supplied. Use normalQuantile for z. Return { risPerGroup, risTotal, p1, p2,
   diversityAdjusted }.
2. obrienFlemingBoundary({ informationFraction, alpha }) -> the O'Brien-Fleming alpha-spending
   two-sided Z boundary at the given information fraction t: Z(t) = z_(alpha/4) / sqrt(t)
   (Lan-DeMets OBF approximation). Return { z, informationFraction }.
3. trialSequentialVerdict({ accruedN, ris, cumulativeZ, alpha }) -> compares the accrued
   information fraction and the cumulative Z against the OBF boundary and returns a discrete
   verdict: conclusive_benefit | conclusive_no_effect | insufficient_information, with a
   defensible rationale. Reuse lib/stats/distributions for all quantiles.
Export a Zod schema locally. app/api/trial-sequential/route.ts: public POST, rate-limited, envelope.

tests: ONE oracle test — a hand-checkable RIS (e.g. controlRisk 0.10, RRR 0.25, alpha 0.05,
power 0.80) and an OBF boundary at t=0.5 (Z = z_0.0125 / sqrt(0.5)), plus a conclusive vs
insufficient verdict. Run ONLY ` + "`npx vitest run tests/trialSequential.test.ts`" + `.`,
  },
  {
    key: 'doseResponse',
    label: 'build:dose-response',
    prompt: REPO + `

BUILD deterministic DOSE-RESPONSE meta-analysis — estimate the linear trend of effect across
dose levels (does more drug mean more effect?), which single-comparison checkers cannot do. Own ONLY:
- lib/doseResponse.ts (new)
- app/api/dose-response/route.ts (new)
- tests/doseResponse.test.ts (new, minimal oracle)

lib/doseResponse.ts (pure) exports doseResponseTrend(points) where each point = { label, dose,
yi (log effect vs common reference), vi }. Fit a weighted linear trend yi ~ b*dose through the
data (inverse-variance weighted least squares; you may center dose). Return { slopePerUnitDose,
slopeSe, slopeZ, slopePValue (studentTCdf or normal), perDoseEffect: [{dose, fitted, ciLower,
ciUpper}], trend: 'increasing'|'decreasing'|'no_trend' (by slope sign + significance at 0.05),
residualQ, residualDf, residualPValue }. Require k>=3 with >=2 distinct doses; return null
otherwise. Reuse lib/stats/distributions. Ratio effects are supplied on the log scale by the
caller (document this). Export a Zod schema locally.
app/api/dose-response/route.ts: public POST, rate-limited, envelope.

tests: ONE oracle test — a monotone dose-response fixture with a hand-checkable positive slope +
SE, and a flat (no_trend) fixture, plus the k<3 guard. Run ONLY
` + "`npx vitest run tests/doseResponse.test.ts`" + `.`,
  },
  {
    key: 'livingEvidence',
    label: 'build:living-evidence',
    prompt: REPO + `

BUILD LIVING-EVIDENCE RE-EVALUATION — re-run a SAVED evidence report's pipeline against the
current cached sources and report whether the verdict/certainty has CHANGED (so a saved
conclusion doesn't silently go stale as new trials are ingested). Own ONLY:
- lib/evidenceReports/reeval.ts (new)
- app/api/evidence-reports/[id]/reevaluate/route.ts (new)
- tests/evidenceReportReeval.test.ts (new, minimal; mock the pipeline)

lib/evidenceReports/reeval.ts exports reevaluateReport(pool, { orgId, reportId }, opts?) that:
  1. Loads the saved report via getReport (org-scoped) — 404-style null if missing;
  2. Re-runs the evidence pipeline for its claim via an INJECTABLE runner (default =
     runEvidencePipeline from lib/evidencePipeline) so the test can mock it;
  3. Diffs the fresh result vs the stored one: { changed: boolean, previous: {verdict,certainty,
     k}, current: {verdict,certainty,k}, delta: {verdictChanged, certaintyChanged, kDelta},
     freshReport }. Pure diff logic; the I/O is behind getReport + the injected runner.
Do NOT edit lib/evidencePipeline.ts or lib/evidenceReports/repository.ts (reserved) — import them.

app/api/evidence-reports/[id]/reevaluate/route.ts: withOrg POST, requireRole(editor) (it may
persist an update — if you update the stored report, writeAudit; otherwise return the diff
read-only), org-scoped via ctx.org.id, envelope. Never trust a client org_id.

tests: ONE test injecting a mock pipeline whose fresh verdict differs from the stored one ->
changed:true with the right delta; and an unchanged case -> changed:false. Run ONLY
` + "`npx vitest run tests/evidenceReportReeval.test.ts`" + `.`,
  },
]

// PHASE 1 — BUILD -> VERIFY
phase('Build')
log('Round 10: trial sequential analysis, dose-response, and living-evidence re-eval in parallel…')
const built = await pipeline(
  BUILD_SPECS,
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { spec: spec.key, build: null, verdict: null }
    return agent(
      REPO + `

ADVERSARIALLY VERIFY the "` + spec.key + `" vertical. Files: ` + (build.filesWritten || []).join(', ') + `.
For tsa: recompute the RIS from the sample-size formula and the OBF boundary z_(alpha/4)/sqrt(t)
by hand and check them; confirm the verdict thresholds are sound. For doseResponse: recompute
the WLS slope + SE by hand on the fixture; confirm k<3 guard and trend classification. For
livingEvidence: confirm getReport is org-scoped, the pipeline runner is injectable/mocked, the
diff is correct, and no client org_id is trusted. Put real problems in issues as 'blocker'.
Default numericallyCorrect=false if you cannot independently confirm.`,
      { label: 'verify:' + spec.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ spec: spec.key, build, verdict }))
  }
)
const verticals = built.filter(Boolean)
const passed = verticals.filter((v) => v.verdict?.numericallyCorrect && v.build?.testsPassing !== false)
log('Build+Verify: ' + passed.length + '/' + verticals.length + ' verticals passed adversarial review.')

// PHASE 2 — CHAIN
phase('Chain')
log('Wiring TSA + dose-response panels into the workbench + nav + authoritative tsc/tests…')
const integration = await agent(
  REPO + `

INTEGRATE round 10 coherently and keep the app green.
1. In app/console/workbench/page.tsx (or a small _component), add an optional "Conclusiveness"
   panel: when the pooled report has raw counts / a control risk and RRR available, call
   /api/trial-sequential and show the RIS, accrued fraction, and the conclusive/insufficient
   verdict. Keep it additive and non-breaking; hide it when inputs are absent.
2. Add a "Re-evaluate" button to the saved-report detail page
   app/console/evidence-reports/[id]/page.tsx that POSTs to the reevaluate route and shows
   whether the verdict/certainty changed (a living-evidence badge). Handle 401/403/error.
3. Nav: no new top-level page expected; add one only if you created a standalone page.
4. Run npx tsc --noEmit and fix type errors in this round's files; run npx vitest run and fix
   genuine breakage (fix wrong CODE, not correct tests).
Report: tsc pass/fail, vitest counts, and every file edited. Be honest if anything is red.`,
  { label: 'integrate:panels+nav', phase: 'Chain', effort: 'high' }
)

// PHASE 3 — HARDEN
phase('Harden')
log('Hardening remaining backlog…')
const harden = await agent(
  REPO + `

HARDEN with MINIMAL correct edits. Do NOT touch owner-reserved files: ` + RESERVED.join(', ') + `.
Targets (address what genuinely applies; do not invent changes):
1. Any public route missing rate limiting / try-catch, or LLM/JSON.parse of untrusted input
   without Zod.
2. Any org-scoped mutation route missing requireRole, or trusting a client org_id.
3. Confirm the new round-10 routes sanitize inputs and never log claim text.
Run npx tsc --noEmit and npx vitest run; report results honestly with the exact files edited.
If clean on a target, say so.`,
  { label: 'harden:api', phase: 'Harden', effort: 'high' }
)

// PHASE 4 — REPORT
phase('Report')
return {
  round: 10,
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

export const meta = {
  name: 'deepen',
  description: 'PaperTrail round 2+: deepen the moat with ported OSS science (Kaplan-Meier/Cox, trim-and-fill), chain the engines into ONE composite evidence-certainty report + endpoint + UI, then self-integrate (nav, tsc, tests) and harden — all in one continuous run, no stops between phases.',
  whenToUse: 'Continue advancing PaperTrail after the meta-analysis/survival/GRADE round: add KM/Cox + trim-and-fill, compose a single evidence report, and wire + verify it end to end.',
  phases: [
    { title: 'Deepen', detail: 'parallel disjoint builds: KM/Cox curves, trim-and-fill, composite evidence report (engine+API+UI)' },
    { title: 'Verify', detail: 'adversarial numeric review of each new engine vs reference formulas' },
    { title: 'Chain', detail: 'integrate: nav wiring, authoritative tsc + full vitest, fix breakages' },
    { title: 'Harden', detail: 'discovery-driven fixes of top backlog issues on shared files' },
    { title: 'Report', detail: 'results + backlog for the next round' },
  ],
}

const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector, Anthropic Claude.
Verifies clinical-trial efficacy claims against primary sources. The MOAT is a
DETERMINISTIC verification engine with NO LLM IN THE NUMERIC LOOP.

Conventions (CLAUDE.md + house rules):
- Deterministic biostatistics are pure, immutable functions, oracle-tested against
  reference tools (metafor/RevMan/epitools/lifelines). NEVER put an LLM in a calculation.
- Reuse lib/stats/distributions.ts for quantiles/CDFs (normalQuantile, ciZ, studentTCdf,
  studentTInverse, chiSquareSurvival, incompleteBeta) — do NOT reimplement them.
- Validate LLM/boundary input with Zod. API routes return { success, data, error } via
  lib/api/response (ok/fail). Public routes: nodejs runtime, rate-limited via lib/rateLimit,
  never log claim text or secrets (mirror app/api/verify/route.ts).
- Small focused files (<400 lines ideal, 800 max). Explicit error handling.

Existing engines (READ for shapes; DO NOT EDIT unless you own the file this round):
  lib/metaAnalysis.ts (metaAnalyze -> MetaAnalysisResult: measure,k,studies[{label,yi,vi,
    point,ciLower,ciUpper,weightRandomPct}],fixed,random{point,ciLower,ciUpper,significant,
    reductionPercent},heterogeneity{q,df,iSquared,tauSquared},predictionInterval),
  lib/synthesisVerification.ts (verifyAgainstSynthesis, SynthesisSource),
  lib/publicationBias.ts (eggersTest, funnelPlotData, interpret; StudyEffect{label,yi,vi}),
  lib/grade.ts (gradeCertainty(input)-> {certainty,downgrades,rationale}; gradeInputSchema),
  lib/survival.ts (hazardRatioFromLogrank, medianSurvivalRatio, absoluteRiskAtTimepoint,
    verifyAgainstSurvival), lib/effectSize.ts (claimedReductionPercent),
  components/synthesis/ForestPlot.tsx.

PRIORITY (user directive): FOCUS ON PRODUCT CODE — engines, API routes, UI, feature
wiring — not test scaffolding. Ship complete working code. Per new engine write at MOST
one minimal oracle sanity test (a few reference-value asserts). Spend the bulk of effort
on real code depth and breadth.`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'filesWritten', 'summary', 'testsPassing'],
  properties: {
    vertical: { type: 'string' },
    filesWritten: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    testsPassing: { type: 'boolean' },
    publicExports: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'numericallyCorrect', 'confidence', 'issues'],
  properties: {
    vertical: { type: 'string' },
    numericallyCorrect: { type: 'boolean' },
    confidence: { type: 'number' },
    issues: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } },
    } },
  },
}

// Owner-exclusive files this round. Non-owners must not edit these.
const RESERVED = [
  'lib/metaAnalysis.ts', 'lib/synthesisVerification.ts', 'lib/grade.ts', 'lib/survival.ts',
  'lib/stats/distributions.ts', 'lib/effectSize.ts', 'lib/publicationBias.ts',
  'lib/evidenceReport.ts', 'lib/survivalCurves.ts', 'app/console/layout.tsx',
  'app/api/evidence-report/route.ts',
]

const BUILD_SPECS = [
  {
    key: 'survivalCurves',
    label: 'build:km-cox',
    prompt: `${REPO}

DEEPEN the survival moat by PORTING the approach of lifelines (MIT) — Kaplan-Meier +
log-rank + a Cox proportional-hazards model for one binary covariate. Own ONLY:
- lib/survivalCurves.ts   (new)
- tests/survivalCurves.test.ts   (new, minimal oracle)

lib/survivalCurves.ts (pure, no LLM, no network) must export:
1. kaplanMeier(events) — given ordered [{time, atRisk, deaths, censored?}] rows (or raw
   [{time, event01}] durations you collapse into a risk table), return the KM survival
   curve [{time, survival, atRisk, deaths, variance, ciLower, ciUpper}] using the product-
   limit estimator with Greenwood's variance and a log-log 95% CI. Provide medianSurvival
   (first time S<=0.5) from the curve.
2. logRankTest(groupA, groupB) — two-group log-rank: sum observed-minus-expected and the
   hypergeometric variance across event times -> chi-square (df=1) + p-value
   (chiSquareSurvival) + the Peto O-E hazard ratio.
3. coxPHbinary(subjects) — Cox partial-likelihood for a single 0/1 covariate via
   Newton-Raphson (Breslow ties): return { beta, hazardRatio=exp(beta), se, ciLower,
   ciUpper, iterations, converged }. Reuse lib/stats/distributions ciZ.
Guard degenerate inputs (return null / converged:false) rather than throwing.

tests/survivalCurves.test.ts: ONE small oracle test locking KM survival + median and a
log-rank / Cox HR to a known textbook example (assert exact reference numbers). Keep it
minimal. Run ONLY \`npx vitest run tests/survivalCurves.test.ts\`. Report filesWritten,
publicExports, testsPassing.`,
  },
  {
    key: 'trimAndFill',
    label: 'build:trim-and-fill',
    prompt: `${REPO}

DEEPEN publication-bias handling by PORTING metafor's trim-and-fill algorithm
(Duval & Tweedie) — port the ALGORITHM, do not link the GPL library. You OWN
lib/publicationBias.ts (extend it) and tests/publicationBias.test.ts (extend). Do not
touch any other file.

Add to lib/publicationBias.ts a pure export:
  trimAndFill(studies, pooledLogEffect?) ->
    { k0Imputed, side: 'left'|'right'|'none', adjustedPooledLogEffect, adjustedPoint,
      adjustedCiLower, adjustedCiUpper, imputed: [{yi, vi}] } | null
Implement the L0 (or R0) estimator to estimate the number of missing studies k0, mirror
them about the pooled effect, and recompute the fixed-effect pooled estimate WITH the
imputed studies (reuse the existing yi/vi inverse-variance math; keep it self-contained).
Require k>=3 usable studies; return null otherwise. Keep the existing eggersTest /
funnelPlotData exports intact.

tests/publicationBias.test.ts: ADD one minimal oracle case — an asymmetric set where
trim-and-fill imputes k0>=1 on the expected side and shifts the pooled estimate toward
the null by a hand-checkable amount; plus a symmetric set giving k0=0. Run ONLY
\`npx vitest run tests/publicationBias.test.ts\`. Report filesWritten, publicExports.`,
  },
  {
    key: 'evidenceReport',
    label: 'build:evidence-report',
    prompt: `${REPO}

CHAIN the engines into ONE composite EVIDENCE REPORT — the headline capability: given a
claim + a set of trials, run meta-analysis -> publication-bias -> GRADE certainty ->
synthesis verdict and return a single defensible object. Own ONLY these NEW files:
- lib/evidenceReport.ts
- app/api/evidence-report/route.ts
- app/console/evidence-report/page.tsx
- app/console/evidence-report/_components/*  (as needed)

lib/evidenceReport.ts (pure orchestration, no LLM) exports buildEvidenceReport({ claim,
studies }) where studies are the same shape SynthesisRequest uses (label, measure, point,
ci_lower, ci_upper, ci_pct | 2x2 counts). Steps:
  1. Map studies -> metaAnalyze StudyEffectInput; run metaAnalyze.
  2. Build StudyEffect[{label,yi,vi}] from the pooled studies; run eggersTest +
     interpret for small-study effects.
  3. Derive a gradeCertainty input from the pooled result (k, iSquared, point=random.point,
     ciLower/ciUpper=random CI, ciCrossesNull = !random.significant, totalN if derivable,
     publicationBiasSteps = 1 when Egger asymmetry is present else 0); run gradeCertainty.
  4. Run verifyAgainstSynthesis-style claim reconciliation (import verifyAgainstSynthesis;
     you may need to map studies to SynthesisSource with a single registered analysis each).
  5. Return { pooled, publicationBias, certainty, verdict, claimedReductionPercent,
     rationale } — a single object a reviewer can defend line by line. Export a Zod
     EvidenceReportRequestSchema locally. Handle <2 studies gracefully.

app/api/evidence-report/route.ts: public POST, nodejs, rate-limited, validates the schema,
returns the envelope. Never log claim text.

app/console/evidence-report/page.tsx ('use client'): a form (claim + N studies) that POSTs
to /api/evidence-report and renders the certainty badge (high/moderate/low/very_low), the
synthesis verdict, pooled fixed+random stats, Egger's p / trim-and-fill note if present,
and REUSE components/synthesis/ForestPlot.tsx for the plot. Mirror the house Tailwind
style (bg-paper, text-ink, accent) and handle loading/error states. Do NOT edit
app/console/layout.tsx (nav is wired in a later phase). Keep files <400 lines.

VERIFY your files are internally type-correct and imports resolve; full tsc runs later.
Report filesWritten, publicExports, testsPassing=true with a one-line summary.`,
  },
]

// ===========================================================================
// PHASE 1 — DEEPEN (parallel, disjoint) -> VERIFY (adversarial, pipelined)
// ===========================================================================
phase('Deepen')
log('Round 2: building KM/Cox, trim-and-fill, and the composite evidence report in parallel…')

const built = await pipeline(
  BUILD_SPECS,
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Deepen', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { spec: spec.key, build: null, verdict: null }
    return agent(
      `${REPO}\n\nADVERSARIALLY VERIFY the "${spec.key}" vertical. Files: ${(build.filesWritten || []).join(', ')}.
Read them and try to find a WRONG NUMBER or broken edge case — recompute the key
statistics by hand from the reference formulas (KM product-limit + Greenwood; log-rank
O-E/variance; Cox partial-likelihood score/information; Duval-Tweedie k0; the GRADE
mapping). Run the vertical's test and judge whether it locks to real reference values.
Check degenerate inputs, k<3, sign conventions, and that NO LLM sits in a numeric path.
Default numericallyCorrect=false if you cannot independently confirm.`,
      { label: `verify:${spec.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ spec: spec.key, build, verdict }))
  }
)
const verticals = built.filter(Boolean)
const passed = verticals.filter((v) => v.verdict?.numericallyCorrect && v.build?.testsPassing !== false)
log(`Deepen+Verify: ${passed.length}/${verticals.length} verticals passed adversarial numeric review.`)

// ===========================================================================
// PHASE 2 — CHAIN / INTEGRATE (single agent, after builds -> no conflicts)
// ===========================================================================
phase('Chain')
log('Integrating: nav wiring + authoritative tsc + full test suite…')
const integration = await agent(
  `${REPO}\n\nINTEGRATE this round's new work so the app is coherent and green. Do:
1. Add a nav link { href: "/console/evidence-report", label: "Evidence Report" } to the
   "Research" section of NAV_SECTIONS in app/console/layout.tsx (place it right after the
   existing "Evidence Synthesis" link). Make the MINIMAL edit.
2. Run \`npx tsc --noEmit\`. If there are type errors in THIS round's new files
   (lib/survivalCurves.ts, lib/publicationBias.ts, lib/evidenceReport.ts,
   app/api/evidence-report/**, app/console/evidence-report/**), fix them minimally.
3. Run \`npx vitest run\`. If a NEW test fails because it asserts a wrong number, fix the
   CODE if the code is wrong, or the assertion if the reference value was mis-transcribed —
   explain which. Do not weaken a test just to make it pass.
Report exactly: tsc pass/fail, vitest pass/fail counts, and every file you edited. Be
honest — if something is still red, say so and describe it.`,
  { label: 'integrate:nav+build', phase: 'Chain', effort: 'high' }
)

// ===========================================================================
// PHASE 3 — HARDEN (discovery-driven; runs after integration so shared-file
// edits are serialized and safe)
// ===========================================================================
phase('Harden')
log('Hardening: fixing top backlog + freshly-found issues on shared files…')
const harden = await agent(
  `${REPO}\n\nHARDEN the codebase. Address these known backlog items plus anything equally
severe you find, with MINIMAL correct edits (add a focused test only where a behavioral
fix needs locking — keep test effort minimal per the code-first directive). Do NOT touch
these owner-reserved files: ${RESERVED.join(', ')}.

Backlog:
1. lib/biostats.ts / lib/metaAnalysis.ts round() — avoid rounding intermediate values that
   feed further computation (round only for display, compute on full-precision values).
   NOTE metaAnalysis.ts is reserved — only address lib/biostats.ts here if applicable.
2. app/api/verify/route.ts — add input validation/sanitization hardening for the claim
   text (reject control chars / absurd inputs beyond the length check) and confirm the
   error paths never leak internal detail. Keep behavior backward compatible.
3. Any unhandled promise / missing try-catch on a public route you find in app/api/**.

After edits run \`npx tsc --noEmit\` and \`npx vitest run\` and report results honestly with
the list of files edited. If everything was already handled, say so rather than inventing
changes.`,
  { label: 'harden:backlog', phase: 'Harden', effort: 'high' }
)

// ===========================================================================
// PHASE 4 — REPORT
// ===========================================================================
phase('Report')
return {
  round: 2,
  verticals: verticals.map((v) => ({
    vertical: v.spec,
    files: v.build?.filesWritten || [],
    exports: v.build?.publicExports || [],
    numericallyCorrect: v.verdict?.numericallyCorrect ?? null,
    confidence: v.verdict?.confidence ?? null,
    blockers: (v.verdict?.issues || []).filter((i) => i.severity === 'blocker'),
    summary: v.build?.summary || '',
  })),
  integrationReport: integration,
  hardenReport: harden,
  passed: passed.length,
  total: verticals.length,
}

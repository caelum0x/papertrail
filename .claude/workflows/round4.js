export const meta = {
  name: 'round4',
  description: 'PaperTrail round 4: network/indirect meta-analysis (Bucher), meta-regression (effect ~ covariate), and a GRADE Summary-of-Findings export — one continuous run with self-integration and hardening.',
  whenToUse: 'Continue advancing PaperTrail: add indirect treatment comparison, meta-regression, and defensible exportable evidence summaries.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint builds: network meta (Bucher), meta-regression, SoF export' },
    { title: 'Verify', detail: 'adversarial numeric review of each engine' },
    { title: 'Chain', detail: 'wire absolute-effects into the evidence report + nav + tsc/tests' },
    { title: 'Harden', detail: 'discovery-driven fixes of remaining backlog' },
    { title: 'Report', detail: 'results + backlog for the next round' },
  ],
}

const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector. Verifies
clinical-trial efficacy claims vs primary sources. MOAT = DETERMINISTIC engine, NO LLM IN
THE NUMERIC LOOP.

Conventions: pure/immutable oracle-tested biostatistics; reuse lib/stats/distributions
(normalQuantile, ciZ, studentTCdf, studentTInverse, chiSquareSurvival, incompleteBeta) —
never reimplement. Zod-validate boundary input. API routes return {success,data,error} via
lib/api/response (ok/fail); public routes are nodejs runtime, rate-limited via lib/rateLimit,
never log claim text (mirror app/api/verify/route.ts). Small files (<400 L).

Existing engines (READ for shapes; DO NOT EDIT unless you own the file this round):
  lib/metaAnalysis.ts (metaAnalyze(inputs)->{measure,k,studies,fixed,random{point,ciLower,
    ciUpper,logPoint,se,significant,reductionPercent},heterogeneity{q,df,iSquared,tauSquared}}),
  lib/grade.ts (gradeCertainty(input)->{certainty,startingLevel,downgrades,rationale}),
  lib/absoluteEffects.ts (absoluteFromRelative({measure,point,ciLower,ciUpper,baselineRisk})
    ->{riskTreated,riskControl,absoluteRiskReduction,nnt,eventsPer1000Treated,...}, formatAbsolute),
  lib/evidenceReport.ts (buildEvidenceReport({claim,studies})->composite; EvidenceReportRequestSchema),
  lib/publicationBias.ts (eggersTest, trimAndFill), lib/effectSize.ts (claimedReductionPercent),
  lib/reportExportHtml.ts (READ for the HTML export style/escaping to mirror).

PRIORITY (user directive): FOCUS ON PRODUCT CODE — engines, API, UI, wiring — not tests.
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
  'lib/metaAnalysis.ts', 'lib/synthesisVerification.ts', 'lib/grade.ts', 'lib/survival.ts',
  'lib/survivalCurves.ts', 'lib/stats/distributions.ts', 'lib/effectSize.ts', 'lib/publicationBias.ts',
  'lib/subgroupAnalysis.ts', 'lib/absoluteEffects.ts', 'lib/networkMeta.ts', 'lib/metaRegression.ts',
  'lib/evidenceReportExport.ts', 'lib/evidenceReport.ts', 'app/console/layout.tsx',
]

const BUILD_SPECS = [
  {
    key: 'networkMeta',
    label: 'build:network-meta',
    prompt: `${REPO}

BUILD deterministic NETWORK / INDIRECT META-ANALYSIS via the Bucher method — estimate an
A-vs-C effect indirectly from A-vs-B and B-vs-C trials (the classic indirect treatment
comparison). Own ONLY:
- lib/networkMeta.ts (new)
- app/api/network-meta/route.ts (new)
- tests/networkMeta.test.ts (new, minimal oracle)

lib/networkMeta.ts (pure) exports:
1. bucherIndirect(ab, bc) where ab/bc are pooled contrasts { logEffect, variance } (log
   scale) for A-vs-B and B-vs-C. Indirect A-vs-C: logAC = logAB + logBC (respect the common
   comparator B direction), Var = Var(AB) + Var(BC). Return { logEffect, variance, se, point
   (exp), ciLower, ciUpper, significant }.
2. combineDirectIndirect(direct, indirect) — inverse-variance combine a direct A-vs-C
   estimate with the indirect one, and report an INCOHERENCE (inconsistency) test:
   z = (logDirect - logIndirect)/sqrt(varDirect+varIndirect), two-sided p (normalQuantile/
   studentTCdf ok via distributions). Return the combined estimate + { incoherenceZ, pValue,
   inconsistent }.
3. Helper poolContrastFromStudies(studies) that reuses metaAnalyze to turn a set of
   StudyEffectInput into a { logEffect, variance } contrast (use random.logPoint + random.se^2).
Export a Zod schema locally. app/api/network-meta/route.ts: public POST, rate-limited, envelope.

tests: ONE oracle test — AB logHR and BC logHR with known variances give the hand-computable
indirect AC (sum of logs, sum of variances, exp back-transform), plus an incoherence case
where direct and indirect disagree significantly. Run ONLY
\`npx vitest run tests/networkMeta.test.ts\`.`,
  },
  {
    key: 'metaRegression',
    label: 'build:meta-regression',
    prompt: `${REPO}

BUILD deterministic META-REGRESSION — regress study log-effects on a study-level moderator
(e.g. dose, baseline risk, year) via weighted least squares, to explain heterogeneity. Own
ONLY:
- lib/metaRegression.ts (new)
- app/api/meta-regression/route.ts (new)
- tests/metaRegression.test.ts (new, minimal oracle)

lib/metaRegression.ts (pure) exports metaRegression(points) where each point = { label, yi
(log effect), vi (variance), x (moderator value) }. Fit yi ~ b0 + b1*x by inverse-variance
weighted least squares (weights 1/vi; optionally add a DerSimonian-Laird-style residual tau^2
via the method of moments and refit — document if you do). Return { intercept, slope,
interceptSe, slopeSe, slopeZ, slopePValue (studentTCdf or normal), residualQ, residualDf,
residualPValue (chiSquareSurvival), rSquaredAnalog }. slopePValue<0.05 => the moderator
explains variation. Require k>=3 distinct x; return null otherwise. Provide a predict(x)
helper on the result or a separate function.
Export a Zod schema locally. app/api/meta-regression/route.ts: public POST, rate-limited, envelope.

tests: ONE oracle test — a small fixture with a clear linear moderator effect where the WLS
slope + its SE are hand-checkable, plus a null-slope fixture and the k<3 guard. Run ONLY
\`npx vitest run tests/metaRegression.test.ts\`.`,
  },
  {
    key: 'sofExport',
    label: 'build:summary-of-findings-export',
    prompt: `${REPO}

BUILD a GRADE "Summary of Findings" (SoF) EXPORT for an evidence report — a defensible,
self-contained HTML document (and a plain-text variant) a medical writer can paste into a
dossier. Own ONLY:
- lib/evidenceReportExport.ts (new)
- app/api/evidence-report/export/route.ts (new)
- tests/evidenceReportExport.test.ts (new, minimal)

READ lib/reportExportHtml.ts for the house export style (HTML escaping, inline CSS, no
external deps) and lib/evidenceReport.ts for the EvidenceReport shape. lib/evidenceReportExport.ts
(pure) exports:
1. evidenceReportToHtml(report, claim) -> a complete <html> string: a header with the claim
   and the certainty badge (high/moderate/low/very_low), a SoF table (measure, pooled
   estimate + 95% CI, k studies, I^2, GRADE certainty with the downgrade reasons), the
   synthesis verdict + rationale, and a publication-bias line. Escape all interpolated text.
2. evidenceReportToText(report, claim) -> a plain-text version.
Do NOT put an LLM anywhere. Handle the insufficient-evidence report shape gracefully.

app/api/evidence-report/export/route.ts: public POST that runs buildEvidenceReport then
returns text/html (or ?format=text) with a Content-Disposition attachment; rate-limited;
never logs claim text.

tests: ONE test — a report renders HTML containing the certainty, the pooled CI, and an
escaped claim; text variant contains the verdict. Run ONLY
\`npx vitest run tests/evidenceReportExport.test.ts\`.`,
  },
]

// PHASE 1 — BUILD -> VERIFY
phase('Build')
log('Round 4: network meta-analysis, meta-regression, and SoF export in parallel…')
const built = await pipeline(
  BUILD_SPECS,
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { spec: spec.key, build: null, verdict: null }
    return agent(
      `${REPO}\n\nADVERSARIALLY VERIFY the "${spec.key}" vertical. Files: ${(build.filesWritten || []).join(', ')}.
Recompute the key statistics by hand from reference formulas (Bucher: sum of log-contrasts +
sum of variances, incoherence z; WLS meta-regression slope/SE + residual Q; SoF HTML escaping
and numbers) and try to find a WRONG NUMBER or broken edge case. Run its test; judge whether
it locks to real reference values. Check degenerate inputs and that NO LLM sits in a numeric
path. Default numericallyCorrect=false if you cannot independently confirm.`,
      { label: `verify:${spec.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ spec: spec.key, build, verdict }))
  }
)
const verticals = built.filter(Boolean)
const passed = verticals.filter((v) => v.verdict?.numericallyCorrect && v.build?.testsPassing !== false)
log(`Build+Verify: ${passed.length}/${verticals.length} verticals passed adversarial review.`)

// PHASE 2 — CHAIN
phase('Chain')
log('Enriching the evidence report with absolute effects + nav + authoritative tsc/tests…')
const integration = await agent(
  `${REPO}\n\nINTEGRATE round 4 coherently and keep the app green.
1. Enrich lib/evidenceReport.ts: when the request includes an optional baselineRisk in (0,1),
   ADD an "absoluteEffects" field to the report by calling absoluteFromRelative with the pooled
   random-effects estimate (measure, point, ciLower, ciUpper, baselineRisk). Make it strictly
   ADDITIVE (omit the field when baselineRisk is absent) and extend EvidenceReportRequestSchema
   with an optional baselineRisk. Do not break existing fields or tests.
2. Surface it in app/console/evidence-report/page.tsx: add an optional baseline-risk input and,
   when present, render ARR / NNT / events-per-1000 from report.absoluteEffects.
3. Nav: add { href: "/console/network-meta", label: "Network Meta" } to the "Research" section
   of NAV_SECTIONS in app/console/layout.tsx ONLY IF app/console/network-meta exists; else skip.
4. Run \`npx tsc --noEmit\` and fix type errors in this round's touched files; run \`npx vitest run\`
   and fix genuine breakage (fix wrong CODE, not correct tests).
Report: tsc pass/fail, vitest counts, and every file edited. Be honest if anything is red.`,
  { label: 'integrate:evidence+nav', phase: 'Chain', effort: 'high' }
)

// PHASE 3 — HARDEN
phase('Harden')
log('Hardening remaining backlog…')
const harden = await agent(
  `${REPO}\n\nHARDEN with MINIMAL correct edits. Do NOT touch owner-reserved files:
${RESERVED.join(', ')}.
Targets (address what genuinely applies; do not invent changes):
1. Any public API route in app/api/** missing try/catch with a user-visible fallback, or any
   LLM JSON parsed without Zod validation.
2. Any numeric public route not rate-limited.
3. Consistency: ensure every new round-3/4 engine's API route uses the shared envelope + rate
   limit + never logs claim text.
Run \`npx tsc --noEmit\` and \`npx vitest run\`; report results honestly with the exact files
edited. If clean on a target, say so.`,
  { label: 'harden:api', phase: 'Harden', effort: 'high' }
)

// PHASE 4 — REPORT
phase('Report')
return {
  round: 4,
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

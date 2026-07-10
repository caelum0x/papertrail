export const meta = {
  name: 'round3',
  description: 'PaperTrail round 3: subgroup/interaction analysis, pooled absolute effects (ARR/NNT with CI), batch evidence reports + export, and wiring evidence-certainty into /api/verify — one continuous run with self-integration and hardening.',
  whenToUse: 'Continue advancing PaperTrail after KM/Cox + trim-and-fill + evidence report: add subgroup analysis, absolute-effect translation, batch reporting, and thread certainty into the core verify path.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint builds: subgroup analysis, absolute effects, batch evidence reports+export' },
    { title: 'Verify', detail: 'adversarial numeric review of each new engine' },
    { title: 'Chain', detail: 'wire evidence-certainty into /api/verify, nav, authoritative tsc + full vitest' },
    { title: 'Harden', detail: 'discovery-driven fixes of remaining backlog on shared files' },
    { title: 'Report', detail: 'results + backlog for the next round' },
  ],
}

const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector, Anthropic Claude.
Verifies clinical-trial efficacy claims vs primary sources. MOAT = DETERMINISTIC engine,
NO LLM IN THE NUMERIC LOOP.

Conventions: pure/immutable oracle-tested biostatistics; reuse lib/stats/distributions
(normalQuantile, ciZ, studentTCdf, studentTInverse, chiSquareSurvival, incompleteBeta) —
never reimplement. Validate boundary input with Zod. API routes return {success,data,error}
via lib/api/response (ok/fail); public routes are nodejs runtime, rate-limited via
lib/rateLimit, never log claim text (mirror app/api/verify/route.ts). Small files (<400 L).

Existing engines (READ for shapes; DO NOT EDIT unless you own the file this round):
  lib/metaAnalysis.ts (metaAnalyze(inputs)->{measure,k,studies[{label,yi,vi,point,ciLower,
    ciUpper,weightRandomPct}],fixed,random{point,ciLower,ciUpper,significant,reductionPercent,
    logPoint,se},heterogeneity{q,df,iSquared,tauSquared},predictionInterval}; StudyEffectInput
    {label,measure:'RR'|'HR'|'OR',point?,ciLower?,ciUpper?,ciPct?,events1?,total1?,events2?,total2?}),
  lib/synthesisVerification.ts (verifyAgainstSynthesis(claim, SynthesisSource[]); SynthesisSource
    {label, analyses: TrialResultAnalysis[]}),
  lib/grade.ts (gradeCertainty(input)->{certainty,downgrades,rationale}),
  lib/publicationBias.ts (eggersTest, trimAndFill, funnelPlotData),
  lib/evidenceReport.ts (buildEvidenceReport({claim,studies})-> full composite; studies use
    label,measure,point,ci_lower,ci_upper,ci_pct OR 2x2 counts; EvidenceReportRequestSchema),
  lib/effectSize.ts (claimedReductionPercent), lib/biostats.ts (riskRatioFromCounts).

PRIORITY (user directive): FOCUS ON PRODUCT CODE — engines, API routes, UI, wiring — not
tests. Ship complete working code. Per new engine write at MOST one minimal oracle sanity
test. Spend the bulk of effort on real code depth/breadth.`

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
  'lib/evidenceReport.ts', 'lib/subgroupAnalysis.ts', 'lib/absoluteEffects.ts', 'lib/evidenceReportBatch.ts',
  'app/console/layout.tsx', 'app/api/verify/route.ts',
]

const BUILD_SPECS = [
  {
    key: 'subgroup',
    label: 'build:subgroup-analysis',
    prompt: `${REPO}

BUILD deterministic SUBGROUP / EFFECT-MODIFICATION analysis — detect when a claim rests on
a subgroup rather than the overall effect. Own ONLY:
- lib/subgroupAnalysis.ts (new)
- app/api/subgroup/route.ts (new)
- tests/subgroupAnalysis.test.ts (new, minimal oracle)

lib/subgroupAnalysis.ts (pure) exports:
1. subgroupAnalysis(subgroups) where each subgroup = { name, studies: StudyEffectInput[] }.
   Pool each subgroup (reuse metaAnalyze), then compute the test for subgroup differences:
   Q_between = sum over subgroups of w_g*(theta_g - theta_pooled)^2 on the log scale using
   each subgroup's pooled estimate + variance, df = (#subgroups - 1), p-value via
   chiSquareSurvival. Return { subgroups:[{name, pooled}], qBetween, df, pValue,
   interactionSignificant, overall }. interactionSignificant when p < 0.05.
2. verifyAgainstSubgroups(claim, subgroups) -> discrete verdict
   (overall_effect_holds | subgroup_only_effect | no_interaction | insufficient_subgroups)
   with a rationale: flag subgroup_only_effect when the claimed magnitude matches one
   subgroup's pooled effect but not the overall, AND the interaction test is significant.
   Reuse effectSize claimedReductionPercent.
Export a Zod schema locally. app/api/subgroup/route.ts: public POST, rate-limited, envelope.

tests: ONE oracle test — two subgroups with clearly different effects giving a significant
Q_between, and a claim matching only the strong subgroup -> subgroup_only_effect; plus a
homogeneous case -> no_interaction. Run ONLY \`npx vitest run tests/subgroupAnalysis.test.ts\`.`,
  },
  {
    key: 'absoluteEffects',
    label: 'build:absolute-effects',
    prompt: `${REPO}

BUILD deterministic ABSOLUTE-EFFECT translation — turn a pooled RELATIVE effect (RR/HR/OR)
+ an assumed baseline (control) risk into absolute numbers clinicians care about: ARR/ARI,
NNT/NNH, and events-per-1000, each with a 95% CI propagated from the relative effect's CI.
Own ONLY:
- lib/absoluteEffects.ts (new)
- tests/absoluteEffects.test.ts (new, minimal oracle)

lib/absoluteEffects.ts (pure) exports:
1. absoluteFromRelative({ measure:'RR'|'HR'|'OR', point, ciLower, ciUpper, baselineRisk })
   -> { riskTreated, riskControl, absoluteRiskReduction, nnt (1/ARR, sign-aware -> NNH when
   harmful), eventsPer1000Treated, eventsPer1000Control, arrCiLower, arrCiUpper, nntCiLower,
   nntCiUpper, direction:'benefit'|'harm'|'null' }. For RR: riskTreated = baseline*RR. For OR:
   convert via odds (oddsC=b/(1-b); oddsT=oddsC*OR; riskT=oddsT/(1+oddsT)). For HR: treat as a
   risk ratio of cumulative incidence at the baseline (document this approximation). Propagate
   the ARR CI by applying the relative-effect CI bounds to the baseline. Guard baselineRisk in
   (0,1); return null otherwise.
2. A small formatAbsolute() helper returning a plain-language sentence
   ("For every 1000 patients treated, ~X fewer events; NNT Y").

tests: ONE oracle test — RR 0.75, baseline 0.10 -> riskTreated 0.075, ARR 0.025, NNT 40, with
CI from the RR CI; an OR case; an NNH (harmful) case. Run ONLY
\`npx vitest run tests/absoluteEffects.test.ts\`.`,
  },
  {
    key: 'batchReports',
    label: 'build:batch-evidence-reports',
    prompt: `${REPO}

BUILD BATCH evidence reporting — run buildEvidenceReport across many claim+study sets in one
call, with a CSV export. Own ONLY:
- lib/evidenceReportBatch.ts (new)
- app/api/evidence-report/batch/route.ts (new)
- tests/evidenceReportBatch.test.ts (new, minimal)

lib/evidenceReportBatch.ts (pure) exports buildEvidenceReportBatch(items) where each item =
{ id?, claim, studies } (studies same shape as EvidenceReportRequestSchema). Import and call
buildEvidenceReport for each; collect { id, verdict, certainty, pooledPoint, pooledCi,
iSquared, publicationBiasFlag, error? } — never throw on one bad item, capture its error and
continue. Also export evidenceReportBatchToCsv(results) producing a deterministic CSV string
(stable column order; quote fields) reusing the style of lib/csvExport.ts if present (read it).
Export a Zod BatchRequestSchema locally (1..50 items).

app/api/evidence-report/batch/route.ts: public POST, rate-limited, envelope; supports
?format=csv returning text/csv with a Content-Disposition attachment; JSON otherwise.

tests: ONE test — a 2-item batch (one clear overstatement, one match) returns two results in
order with the right verdicts, and CSV has a header + 2 rows. Run ONLY
\`npx vitest run tests/evidenceReportBatch.test.ts\`.`,
  },
]

// PHASE 1 — BUILD (parallel disjoint) -> VERIFY (adversarial, pipelined)
phase('Build')
log('Round 3: subgroup analysis, absolute effects, and batch evidence reports in parallel…')
const built = await pipeline(
  BUILD_SPECS,
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { spec: spec.key, build: null, verdict: null }
    return agent(
      `${REPO}\n\nADVERSARIALLY VERIFY the "${spec.key}" vertical. Files: ${(build.filesWritten || []).join(', ')}.
Recompute the key statistics by hand from reference formulas (Q_between subgroup test; ARR/
NNT + CI propagation; OR->risk conversion; batch aggregation/CSV) and try to find a WRONG
NUMBER or broken edge case. Run its test; judge whether it locks to real reference values.
Check degenerate inputs and that NO LLM sits in a numeric path. Default
numericallyCorrect=false if you cannot independently confirm.`,
      { label: `verify:${spec.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ spec: spec.key, build, verdict }))
  }
)
const verticals = built.filter(Boolean)
const passed = verticals.filter((v) => v.verdict?.numericallyCorrect && v.build?.testsPassing !== false)
log(`Build+Verify: ${passed.length}/${verticals.length} verticals passed adversarial review.`)

// PHASE 2 — CHAIN: thread certainty into /api/verify + nav + authoritative build
phase('Chain')
log('Wiring evidence-certainty into /api/verify, nav, and running authoritative tsc + tests…')
const integration = await agent(
  `${REPO}\n\nINTEGRATE round 3 coherently and keep the app green.
1. /api/verify enrichment: READ app/api/verify/route.ts. When the verify flow has MULTIPLE
   confident cross-source registered results (it already computes cross_source_agreement and
   has access to registered analyses), attach an OPTIONAL "evidence_certainty" field to the
   response by pooling those sources' primary ratio results via metaAnalyze and rating them
   with gradeCertainty (map k/iSquared/pooled CI/crossesNull like lib/evidenceReport.ts does).
   Make it strictly ADDITIVE — never change or remove existing response fields, and skip
   silently (omit the field) when there are <2 poolable sources. Wrap in try/catch so it can
   never break the core verify response. Do not log claim text.
2. Nav: add { href: "/console/subgroup", label: "Subgroup Analysis" } to the "Research"
   section of NAV_SECTIONS in app/console/layout.tsx ONLY IF a page app/console/subgroup
   exists; otherwise skip. (There is no batch/absolute console page — API only — so no nav.)
3. Run \`npx tsc --noEmit\` and fix any type errors in THIS round's files. Run \`npx vitest run\`
   and fix genuine breakage (fix wrong CODE, not correct tests).
Report: tsc pass/fail, vitest counts, and every file edited. Be honest if anything is red.`,
  { label: 'integrate:verify+nav', phase: 'Chain', effort: 'high' }
)

// PHASE 3 — HARDEN
phase('Harden')
log('Hardening remaining backlog on shared files…')
const harden = await agent(
  `${REPO}\n\nHARDEN the codebase with MINIMAL correct edits. Do NOT touch owner-reserved files:
${RESERVED.join(', ')}.
Targets (address what genuinely applies; do not invent changes):
1. Public API routes in app/api/** missing a try/catch with a user-visible fallback, or that
   could leak internal error detail — wrap them and return the {success,data,error} envelope.
2. Any place an LLM JSON response is JSON.parsed without Zod validation — add validation.
3. Confirm no route logs claim text or secrets.
Then run \`npx tsc --noEmit\` and \`npx vitest run\` and report results honestly with the exact
files edited. If the codebase is already clean on a target, say so.`,
  { label: 'harden:api', phase: 'Harden', effort: 'high' }
)

// PHASE 4 — REPORT
phase('Report')
return {
  round: 3,
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

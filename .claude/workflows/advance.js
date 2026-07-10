export const meta = {
  name: 'advance',
  description: 'PaperTrail self-driving coding loop: discover problems + OSS reuse, build disjoint moat/feature verticals in parallel, adversarially verify the biostatistics, fix P0s, report a backlog for the next round.',
  whenToUse: 'Run to push PaperTrail forward: deepen the deterministic verification moat, add new evidence-science capabilities, and kill bugs — one bounded, verified round at a time.',
  phases: [
    { title: 'Discover', detail: 'parallel read-only finders: moat correctness, platform bugs, test gaps, OSS reuse' },
    { title: 'Build', detail: 'parallel disjoint new-file verticals (survival, publication-bias, GRADE, meta-analysis API+UI)' },
    { title: 'Verify', detail: 'adversarial numeric review of each new engine against reference formulas' },
    { title: 'Fix', detail: 'address the top P0 findings on shared files (after builds, no conflicts)' },
    { title: 'Report', detail: 'synthesize results + prioritized backlog for the next round' },
  ],
}

// ---------------------------------------------------------------------------
// Shared context every agent needs: the repo's hard conventions. Kept short so
// it can be prepended to each prompt without bloating token cost.
// ---------------------------------------------------------------------------
const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector, Anthropic Claude.
It verifies clinical-trial efficacy claims against primary sources. The MOAT is a
DETERMINISTIC verification engine with NO LLM IN THE NUMERIC LOOP.

Non-negotiable conventions (from CLAUDE.md + house rules):
- Deterministic biostatistics are pure functions, oracle-tested against reference
  tools (metafor/RevMan/epitools). NEVER put an LLM in a numeric calculation.
- All LLM structured output validated with Zod before use. Validate at boundaries.
- API routes return the envelope { success, data, error } via lib/api/response
  (ok/fail/created). Public routes (see app/api/verify/route.ts) are nodejs runtime,
  rate-limited via lib/rateLimit, and never log claim text or secrets.
- Immutability: never mutate inputs; return new objects. Small focused files (<800 lines).
- Explicit error handling with user-visible fallbacks. No hardcoded secrets.
- Existing deterministic engines to MATCH in style: lib/biostats.ts, lib/effectSize.ts,
  lib/structuredVerification.ts, lib/metaAnalysis.ts, lib/synthesisVerification.ts,
  lib/stats/distributions.ts. Tests live in tests/*.test.ts (vitest).

PRIORITY (user directive): FOCUS ON PRODUCT CODE — engines, API routes, UI, feature
wiring — not test scaffolding. Ship complete, working code first. For each new engine
write at MOST one minimal oracle sanity test (a handful of reference-value asserts) to
prove the numbers are right; do NOT build large test suites. Spend the bulk of effort on
depth and breadth of the actual code (more capability, more endpoints, more UI).`

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'severity', 'file', 'detail', 'fix'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          file: { type: 'string', description: 'path:line or path' },
          detail: { type: 'string' },
          fix: { type: 'string', description: 'concrete remediation' },
          sharedFile: { type: 'boolean', description: 'true if fixing this edits a file a build vertical also owns' },
        },
      },
    },
  },
}

const OSS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recommendations'],
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['need', 'repoOrPackage', 'license', 'adopt', 'why'],
        properties: {
          need: { type: 'string' },
          repoOrPackage: { type: 'string' },
          license: { type: 'string' },
          adopt: { type: 'string', enum: ['use-library', 'port-approach', 'reference-only', 'avoid'] },
          why: { type: 'string' },
        },
      },
    },
  },
}

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vertical', 'filesWritten', 'summary', 'testsPassing', 'testCommand'],
  properties: {
    vertical: { type: 'string' },
    filesWritten: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    testsPassing: { type: 'boolean' },
    testCommand: { type: 'string' },
    notes: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vertical', 'numericallyCorrect', 'confidence', 'issues'],
  properties: {
    vertical: { type: 'string' },
    numericallyCorrect: { type: 'boolean' },
    confidence: { type: 'number' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'detail'],
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          detail: { type: 'string' },
        },
      },
    },
  },
}

// Files owned by the current in-flight work + build verticals. Finders must NOT
// propose fixes that edit these as shared (a build agent owns them this round).
const RESERVED = [
  'lib/schemas.ts', 'app/console/layout.tsx',
  'lib/metaAnalysis.ts', 'lib/synthesisVerification.ts', 'lib/stats/distributions.ts',
  'lib/survival.ts', 'lib/publicationBias.ts', 'lib/grade.ts',
  'app/api/synthesis/route.ts', 'app/api/survival/route.ts',
]

// ---------------------------------------------------------------------------
// Build verticals — each owns a DISJOINT set of NEW files, so they run fully in
// parallel with zero merge conflict. Each must be self-contained (own Zod schema
// in its own file; do NOT edit lib/schemas.ts) and oracle-tested.
// ---------------------------------------------------------------------------
const BUILD_SPECS = [
  {
    key: 'survival',
    label: 'build:survival-engine',
    prompt: `${REPO}

BUILD a deterministic SURVIVAL / TIME-TO-EVENT engine — a new moat capability.
Own ONLY these NEW files (create them; do not touch any other file):
- lib/survival.ts
- tests/survival.test.ts
- app/api/survival/route.ts

lib/survival.ts (pure, no LLM, no network) must export functions for:
1. hazardRatioFromLogrank(observedEvents, expectedEvents, varianceOrO_E) OR the
   Peto O–E method: HR = exp((O1 - E1) / V) with 95% CI from V. Document the inputs.
2. medianSurvivalRatio(medianTreatment, medianControl) with a guard for zeros.
3. absoluteRiskAtTimepoint from Kaplan–Meier survival probabilities (S_control(t) -
   S_treat(t)) → ARR at t, plus NNT = 1/ARR.
4. A claim reconciler verifyAgainstSurvival(claim, data) that returns a discrete
   verdict union (e.g. matches_hr / overstates_hr / median_vs_hr_mismatch /
   not_significant / cannot_reconcile) with a defensible rationale string — mirror the
   shape/philosophy of lib/synthesisVerification.ts. Reuse lib/effectSize.ts
   claimedReductionPercent for parsing the claim, and lib/stats/distributions.ts for
   any z/t/chi-square you need. Do NOT reimplement the normal quantile.
Export a Zod schema (SurvivalRequestSchema) FROM THIS FILE for the API to use.

tests/survival.test.ts: ORACLE tests locking values to reference formulas — e.g. a
Peto O–E HR against a known logrank example, median ratio, ARR@t / NNT. Follow the
existing tests/biostatsOracle.test.ts discipline (assert exact reference numbers).

app/api/survival/route.ts: public POST, nodejs runtime, rate-limited via
lib/rateLimit (mirror app/api/verify/route.ts), validates SurvivalRequestSchema,
returns the { success, data, error } envelope. Never log claim text.

VERIFY before finishing: run ONLY \`npx vitest run tests/survival.test.ts\` and make it
green. Do NOT run the full test suite or full tsc (other agents are writing files
concurrently). Report filesWritten, whether your tests pass, and the test command.`,
  },
  {
    key: 'publicationBias',
    label: 'build:publication-bias',
    prompt: `${REPO}

BUILD a deterministic PUBLICATION-BIAS / small-study-effects detector that operates on
a set of meta-analysis study effects (log effect yi + variance vi). This complements
lib/metaAnalysis.ts (read it for the StudyEffect shape; do NOT edit it).
Own ONLY these NEW files:
- lib/publicationBias.ts
- tests/publicationBias.test.ts

lib/publicationBias.ts (pure) must export:
1. eggersTest(studies) — Egger's regression of the standardized effect (yi/se) on
   precision (1/se): returns intercept, its SE, t statistic, df=k-2, and a two-sided
   p-value (use lib/stats/distributions.ts studentTCdf). Interpret intercept != 0 as
   small-study asymmetry. Require k>=3; return null otherwise.
2. funnelPlotData(studies, pooledLogEffect) — per-study { effect, se, standardError,
   deviation } arrays suitable for a funnel plot, plus pseudo-95% CI bounds.
3. A short interpret() helper returning a discrete verdict
   (no_asymmetry / possible_small_study_effects / insufficient_studies).
Define the StudyEffect input type locally (label, yi, vi) or import the type from
lib/metaAnalysis.ts — do not edit that file.

tests/publicationBias.test.ts: ORACLE test Egger's intercept + p-value against a
hand-computed / reference example (assert exact numbers), an insufficient-k guard, and
a symmetric-set case that yields no asymmetry.

VERIFY: run ONLY \`npx vitest run tests/publicationBias.test.ts\` green. Do not run the
full suite or full tsc. Report filesWritten and test status.`,
  },
  {
    key: 'grade',
    label: 'build:grade-certainty',
    prompt: `${REPO}

BUILD a deterministic GRADE-style EVIDENCE-CERTAINTY rating engine. Given a pooled
meta-analysis summary (k studies, I², pooled point + 95% CI, whether the CI crosses the
null, total sample size if available, and flags for risk-of-bias / indirectness /
publication-bias), rate certainty as high | moderate | low | very_low by applying the
standard GRADE downgrade rules deterministically (inconsistency from high I²,
imprecision from a wide CI or CI crossing the null / small N, plus caller-supplied
risk-of-bias, indirectness, publication-bias downgrades). NO LLM.
Own ONLY these NEW files:
- lib/grade.ts
- tests/grade.test.ts

lib/grade.ts (pure) must export gradeCertainty(input) returning
{ certainty, startingLevel, downgrades: [{domain, reason, steps}], rationale }.
Encode explicit thresholds (e.g. I² >= 50 → inconsistency downgrade; I² >= 75 → consider
2 steps; CI crossing null OR ratio CI spanning an appreciable range → imprecision).
Document each threshold in a comment. Export a Zod schema locally if useful.

tests/grade.test.ts: table-driven tests covering high (consistent, precise,
significant) → high; high I² → downgrade; wide/null-crossing CI → imprecision downgrade;
multiple downgrades → low/very_low. Assert exact certainty + which domains downgraded.

VERIFY: run ONLY \`npx vitest run tests/grade.test.ts\` green. No full suite / full tsc.
Report filesWritten and test status.`,
  },
  {
    key: 'metaUi',
    label: 'build:meta-analysis-api-ui',
    prompt: `${REPO}

FINISH the meta-analysis vertical: expose the already-built engine
(lib/metaAnalysis.ts metaAnalyze + lib/synthesisVerification.ts verifyAgainstSynthesis)
via a public API and a console UI with a deterministic forest plot. READ those files and
lib/schemas.ts (SynthesisRequestSchema already exists there) — do NOT edit them.
Also read app/api/verify/route.ts (mirror its public/rate-limited style) and an existing
console page (app/console/claims/page.tsx) + app/console/claims/_components for house UI
patterns (Tailwind classes bg-paper, text-ink, accent, etc.). Do NOT edit
app/console/layout.tsx (nav is wired separately).
Own ONLY these NEW files (create dirs as needed):
- app/api/synthesis/route.ts  (public POST, nodejs, rate-limited, validates
  SynthesisRequestSchema from @/lib/schemas, maps the request 'studies' to metaAnalyze
  StudyEffectInput, runs verifyAgainstSynthesis, returns the { success, data, error }
  envelope with the pooled result + verdict. Map snake_case request fields
  (ci_lower/ci_upper/ci_pct) to the engine's camelCase.)
- components/synthesis/ForestPlot.tsx  ('use client'; pure SVG; one row per study with a
  square sized by weight and a horizontal CI line on a log axis, plus a diamond for the
  pooled random-effects estimate and a dashed null line at 1. No chart library.)
- app/console/synthesis/page.tsx  ('use client'; a form to add N studies (label, measure,
  point, CI) + a claim box; POSTs to /api/synthesis; renders the verdict, pooled fixed &
  random estimates, I²/tau²/Q, prediction interval, and the ForestPlot. Handle loading /
  error states like the claims page.)
- Any small _components you need UNDER app/console/synthesis/ only.

Keep files focused (<400 lines). Do not put an LLM anywhere in this path.

VERIFY: run \`npx tsc --noEmit\` is NOT reliable while others write files — instead just
make sure YOUR files are internally type-correct and imports resolve. Report filesWritten
and a one-line summary. testsPassing may be true with testCommand "n/a (UI vertical)".`,
  },
]

// ===========================================================================
// PHASE 1 — DISCOVER (parallel, read-only; safe to fan out wide)
// ===========================================================================
phase('Discover')
log('Fanning out read-only finders across the moat, platform, tests, and OSS landscape…')

const discovery = await parallel([
  () => agent(
    `${REPO}\n\nYou are a BIOSTATISTICS CORRECTNESS auditor. Read the deterministic engines:
lib/biostats.ts, lib/effectSize.ts, lib/structuredVerification.ts, lib/metaAnalysis.ts,
lib/synthesisVerification.ts, lib/stats/distributions.ts. Hunt for numeric bugs, wrong
formulas, missing edge cases (zero cells, k=2, CI recovery), and study designs the moat
still can't handle. Rank by severity. Be specific with file:line and the exact fix.`,
    { label: 'find:moat-correctness', phase: 'Discover', schema: FINDING_SCHEMA, agentType: 'Explore' }
  ),
  () => agent(
    `${REPO}\n\nYou are a PLATFORM RELIABILITY + SECURITY auditor. Sweep app/api/**/route.ts
and lib/** for: unvalidated LLM JSON (JSON.parse without Zod), missing try/catch with a
user-visible fallback, trust-boundary / org-scoping gaps, SQL built by string
concatenation, secrets or claim text in logs, and missing rate limiting on public routes.
Report the highest-severity, most concrete issues with file:line and a fix. Mark
sharedFile=true when the fix edits a file a build vertical might own.`,
    { label: 'find:platform-bugs', phase: 'Discover', schema: FINDING_SCHEMA, agentType: 'Explore' }
  ),
  () => agent(
    `${REPO}\n\nYou are a TEST-COVERAGE auditor. Identify the highest-value UNTESTED logic
(critical deterministic paths, API handlers, parsers) that a bug could slip through.
Return each as a finding whose 'fix' names the specific test file + cases to add.`,
    { label: 'find:test-gaps', phase: 'Discover', schema: FINDING_SCHEMA, agentType: 'Explore' }
  ),
  () => agent(
    `${REPO}\n\nYou are an OSS-REUSE researcher. Per the house rule "GitHub/registry search
before writing new code", research proven open-source repos/packages PaperTrail should
adopt or port for: survival/time-to-event stats, meta-analysis (metafor-equivalent),
publication-bias tests, PDF/table extraction, and clinical-trial registry parsing. Use
web search and \`gh search repos\`/\`gh search code\` (via your tools). For each, give the
repo/package, license (MUST be permissive — MIT/BSD/Apache), and whether to use it
directly, port the approach, or just reference it, with why. Prefer battle-tested,
maintained, permissively-licensed options; flag GPL/AGPL as avoid.`,
    { label: 'research:oss', phase: 'Discover', schema: OSS_SCHEMA, agentType: 'Explore' }
  ),
])

const findings = [discovery[0], discovery[1], discovery[2]]
  .filter(Boolean)
  .flatMap((d) => d.findings || [])
const oss = discovery[3]?.recommendations || []
const p0 = findings.filter((f) => f.severity === 'P0')
const p1 = findings.filter((f) => f.severity === 'P1')
log(`Discovery: ${findings.length} findings (${p0.length} P0, ${p1.length} P1), ${oss.length} OSS recommendations.`)

// ===========================================================================
// PHASE 2+3 — BUILD (parallel, disjoint files) → VERIFY (adversarial numeric)
// Pipeline: each vertical is verified the moment its build finishes.
// ===========================================================================
phase('Build')
log('Building 4 disjoint verticals in parallel; each is adversarially verified on completion…')

const built = await pipeline(
  BUILD_SPECS,
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { spec: spec.key, build: null, verdict: null }
    // Adversarial numeric review — read-only, tries to break the new engine.
    return agent(
      `${REPO}\n\nADVERSARIALLY VERIFY the "${spec.key}" vertical just built. Files:
${(build.filesWritten || []).join(', ')}.
Read them. Your job is to find a WRONG NUMBER or a broken edge case, not to praise.
Recompute the key statistics by hand from the reference formulas and compare. Run the
vertical's test command (${build.testCommand}) and read the assertions critically — do
they lock to real reference values or to whatever the code happens to output? Check:
zero/degenerate inputs, k<3, CI recovery, sign conventions, and that NO LLM sits in a
numeric path. Default to numericallyCorrect=false if you cannot independently confirm.`,
      { label: `verify:${spec.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ spec: spec.key, build, verdict }))
  }
)

const verifiedBuilds = built.filter(Boolean)
const passed = verifiedBuilds.filter((b) => b.verdict?.numericallyCorrect && b.build?.testsPassing !== false)
const flagged = verifiedBuilds.filter((b) => !b.verdict?.numericallyCorrect || b.build?.testsPassing === false)
log(`Build+Verify: ${passed.length}/${verifiedBuilds.length} verticals passed adversarial numeric review.`)

// ===========================================================================
// PHASE 4 — FIX (after builds complete, so shared-file edits can't conflict)
// ===========================================================================
phase('Fix')
const fixable = [...p0, ...p1].filter((f) => !RESERVED.some((r) => (f.file || '').includes(r)))
let fixReport = 'No safe P0/P1 findings to fix this round.'
if (fixable.length > 0) {
  log(`Fixing ${Math.min(fixable.length, 6)} top P0/P1 findings on shared files…`)
  const top = fixable.slice(0, 6)
  fixReport = await agent(
    `${REPO}\n\nFix the following verified issues. Make MINIMAL, correct edits, add or update
a test for each behavioral fix where practical, and do not touch any of these reserved
files (another build owns them this round): ${RESERVED.join(', ')}.
After your edits, run \`npx tsc --noEmit\` and \`npx vitest run\` and report the results
honestly — if something still fails, say so.

Issues:
${top.map((f, i) => `${i + 1}. [${f.severity}] ${f.title} (${f.file})\n   ${f.detail}\n   Fix: ${f.fix}`).join('\n')}`,
    { label: 'fix:p0-p1', phase: 'Fix', effort: 'high' }
  )
}

// ===========================================================================
// PHASE 5 — REPORT
// ===========================================================================
phase('Report')
return {
  summary: {
    findings: findings.length,
    p0: p0.length,
    p1: p1.length,
    verticalsBuilt: verifiedBuilds.length,
    verticalsPassed: passed.length,
  },
  builds: verifiedBuilds.map((b) => ({
    vertical: b.spec,
    files: b.build?.filesWritten || [],
    testsPassing: b.build?.testsPassing ?? null,
    numericallyCorrect: b.verdict?.numericallyCorrect ?? null,
    confidence: b.verdict?.confidence ?? null,
    blockers: (b.verdict?.issues || []).filter((i) => i.severity === 'blocker'),
    summary: b.build?.summary || '',
  })),
  flaggedForFollowup: flagged.map((b) => ({ vertical: b.spec, issues: b.verdict?.issues || [] })),
  fixReport,
  ossRecommendations: oss,
  backlog: {
    p0: p0.map((f) => ({ title: f.title, file: f.file, fix: f.fix })),
    p1: p1.map((f) => ({ title: f.title, file: f.file, fix: f.fix })),
    deferredReserved: [...p0, ...p1]
      .filter((f) => RESERVED.some((r) => (f.file || '').includes(r)))
      .map((f) => ({ title: f.title, file: f.file })),
  },
  integrationNeeded: [
    'Add nav link(s) for /console/synthesis (+ survival) to NAV_SECTIONS in app/console/layout.tsx',
    'Run authoritative `npx tsc --noEmit` and full `npx vitest run`',
    'Wire survival/grade/publication-bias into the verify pipeline if desired',
  ],
}

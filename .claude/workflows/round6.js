export const meta = {
  name: 'round6',
  description: 'PaperTrail round 6: auto-synthesis from cached sources (connect the moat to real data), production infra (Vercel cron so jobs fire + real /api/health), and forest/funnel/bubble visualizations — one continuous run with self-integration and hardening.',
  whenToUse: 'Connect the deterministic engines to cached PubMed/ClinicalTrials sources, close the scheduled-jobs gap, and deepen the visual layer.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint builds: auto-synthesis-from-sources, production infra, visualizations' },
    { title: 'Verify', detail: 'adversarial review of extraction correctness + infra safety' },
    { title: 'Chain', detail: 'wire auto-synthesis + funnel plot into the workbench UI + nav + tsc/tests' },
    { title: 'Harden', detail: 'discovery-driven fixes on shared files' },
    { title: 'Report', detail: 'results + backlog for the next round' },
  ],
}

const REPO = `PaperTrail — Next.js 14 (App Router, TS strict) + Postgres/pgvector (pg Pool via
lib/db getPool), Vercel deploy. Verifies clinical-trial efficacy claims vs primary sources.
MOAT = DETERMINISTIC engine, NO LLM IN THE NUMERIC LOOP.

Conventions: pure/immutable oracle-tested biostatistics; reuse lib/stats/distributions —
never reimplement. Zod-validate boundary input. PUBLIC compute routes mirror
app/api/verify/route.ts (nodejs runtime, rate-limited via lib/rateLimit, {success,data,error}
envelope via lib/api/response ok/fail, never log claim text). Cached sources live in a 'sources'
table (source_type 'pubmed'|'clinicaltrials', external_id, title, raw_text, url, and jsonb
'registered_results' = TrialResultAnalysis[] for CT.gov). READ lib/queries/sources.ts,
lib/sources/*, and lib/synthesisVerification.ts (buildSynthesisInputs / SynthesisSource) +
lib/effectSize.ts (parseEffectSizes) for how effects are extracted deterministically.

Existing engines (READ; DO NOT EDIT unless you own the file this round):
  lib/evidenceReport.ts (buildEvidenceReport({claim,studies,baselineRisk?})->composite),
  lib/synthesisVerification.ts (buildSynthesisInputs, verifyAgainstSynthesis, SynthesisSource),
  lib/structuredVerification.ts (checkAgainstRegistry), lib/effectSize.ts (parseEffectSizes,
  claimedReductionPercent), lib/metaAnalysis.ts (StudyEffectInput), components/synthesis/ForestPlot.tsx.

PRIORITY (user directive): FOCUS ON PRODUCT CODE — engines, API, UI, infra wiring — not tests.
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
  'lib/metaAnalysis.ts', 'lib/synthesisVerification.ts', 'lib/evidenceReport.ts', 'lib/effectSize.ts',
  'lib/structuredVerification.ts', 'lib/stats/distributions.ts', 'lib/autoSynthesis.ts',
  'app/console/layout.tsx', 'app/api/health/route.ts', 'vercel.json', 'lib/db.ts',
]

const BUILD_SPECS = [
  {
    key: 'autoSynthesis',
    label: 'build:auto-synthesis',
    prompt: `${REPO}

BUILD AUTO-SYNTHESIS FROM CACHED SOURCES — the feature that connects the moat to real data:
given a claim + a set of cached source IDs, DETERMINISTICALLY extract each source's effect
estimate and pool them into a full evidence report, instead of the user hand-typing numbers.
Own ONLY:
- lib/autoSynthesis.ts (new)
- app/api/auto-synthesis/route.ts (new)
- tests/autoSynthesis.test.ts (new, minimal oracle)

lib/autoSynthesis.ts (pure orchestration over provided data — NO direct DB in the lib; the
route loads rows and passes them in) exports:
1. extractStudyFromSource(source) where source = { id, source_type, title, raw_text,
   registered_results? }. For 'clinicaltrials': pick the primary ratio analysis from
   registered_results (reuse the logic shape in buildSynthesisInputs / measureOf) ->
   { label, measure, point, ci_lower, ci_upper }. For 'pubmed': run parseEffectSizes on
   raw_text and take the primary ratio effect with a CI when present. Return null (with a
   captured reason) when no usable effect is found — never fabricate.
2. autoSynthesize({ claim, sources }) -> { studies, skipped:[{id,reason}], report } where it
   builds the studies, calls buildEvidenceReport({claim,studies}) when >=2 studies, and returns
   an honest insufficient result otherwise. NO LLM in the numeric path.
Export a Zod schema locally.

app/api/auto-synthesis/route.ts: public POST { claim, source_ids: string[] } (nodejs, rate-
limited, envelope). Load the named sources from the 'sources' table via a small org/public
query (READ lib/queries/sources.ts for the access pattern; if sources are org-scoped, use
withOrg instead of the public style — match whatever /api/sources does). Pass rows into
autoSynthesize; return the report + which sources were skipped and why. Never log claim text.

tests: ONE oracle test with in-memory fixture sources (a CT.gov row with registered_results
HR + CI, and a PubMed row whose raw_text contains "HR 0.80 (95% CI 0.70-0.92)") -> two studies
extracted and pooled; plus a no-effect source captured in skipped. Run ONLY
\`npx vitest run tests/autoSynthesis.test.ts\`.`,
  },
  {
    key: 'infra',
    label: 'build:production-infra',
    prompt: `${REPO}

CLOSE THE PRODUCTION-INFRA GAP. Today there is no vercel.json, so background jobs/monitors
NEVER fire on a schedule, and /api/health is a 25-line stub. Own ONLY:
- vercel.json (new)
- app/api/health/route.ts (REWRITE — you own it this round)
- README.md (append a concise "Evidence Synthesis API" section only; do not rewrite the file)

vercel.json: add a Vercel Cron schedule that calls the existing internal tick endpoints on a
sensible cadence — READ app/api/jobs/tick/route.ts (and any app/api/monitors/[id]/run or a
monitors sweep) to see what exists, and schedule GET/POST to app/api/jobs/tick (e.g. every 5
minutes) plus any monitors sweep hourly. Use the Vercel 'crons' array format
([{ "path": "/api/jobs/tick", "schedule": "*/5 * * * *" }]). If the tick route needs a method
Cron can't send, note it and pick the compatible one. Do not invent endpoints that don't exist.

app/api/health/route.ts: return a REAL status object — { status: 'ok'|'degraded', checks: {
db: boolean, ... }, version, timestamp } — actually pinging the DB via checkDbConnection from
lib/db (it exists) with a short timeout and a try/catch so /health itself never 500s. Keep it
public and cheap. Do not leak secrets or connection strings.

README.md: append one short section documenting the new public endpoints (/api/synthesis,
/api/evidence-report[/export][/batch], /api/continuous-meta, /api/network-meta,
/api/meta-regression, /api/subgroup, /api/survival, /api/auto-synthesis) with a one-line each
+ a single curl example. Keep it tight.

Report filesWritten. testsPassing=true, testCommand "n/a (infra)".`,
  },
  {
    key: 'viz',
    label: 'build:visualizations',
    prompt: `${REPO}

BUILD reusable deterministic VISUALIZATION components (pure SVG, no chart library, 'use client')
for the evidence layer. Own ONLY:
- components/synthesis/FunnelPlot.tsx (new)
- components/synthesis/BubblePlot.tsx (new)
- components/synthesis/HeterogeneityBar.tsx (new)

FunnelPlot.tsx: props = per-study { label, effect (log or ratio), standardError } + pooled
effect + pseudo-95% CI funnel edges (matches lib/publicationBias.ts funnelPlotData output).
Render the classic inverted funnel: x = effect, y = standard error (inverted, apex at top),
with the two diagonal pseudo-CI lines and a vertical line at the pooled effect. Points outside
the funnel hint at asymmetry.
BubblePlot.tsx: props = per-study { label, x (moderator), y (effect), weight } + a fitted line
[{x,yFitted}] (matches lib/metaRegression.ts fittedLine). Bubble radius ~ sqrt(weight); draw
the regression line. For meta-regression display.
HeterogeneityBar.tsx: props = { iSquared } — a small labeled bar shading low/moderate/
substantial/considerable bands (25/50/75) with the value marked.
Mirror the house Tailwind style and the SVG approach in components/synthesis/ForestPlot.tsx
(READ it). Keep each component focused and self-contained; accessible (title/aria where useful).

Report filesWritten. testsPassing=true, testCommand "n/a (UI components)".`,
  },
]

// PHASE 1 — BUILD -> VERIFY
phase('Build')
log('Round 6: auto-synthesis from cached sources, production infra, and visualizations in parallel…')
const built = await pipeline(
  BUILD_SPECS,
  (spec) => agent(spec.prompt, { label: spec.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, spec) => {
    if (!build) return { spec: spec.key, build: null, verdict: null }
    return agent(
      `${REPO}\n\nADVERSARIALLY VERIFY the "${spec.key}" vertical. Files: ${(build.filesWritten || []).join(', ')}.
For autoSynthesis: confirm extraction is deterministic (NO LLM), never fabricates an effect,
correctly reads CT.gov registered_results vs PubMed raw_text, and pools only >=2 real studies;
try to make it invent a number. For infra: confirm vercel.json only references endpoints that
EXIST, the cron cadence is sane, /api/health never 500s and leaks nothing, and README is
accurate. For viz: confirm the SVG math is sound (axes, scaling) and components are pure.
Put correctness/safety problems in issues as 'blocker'. Default numericallyCorrect=false if you
cannot independently confirm.`,
      { label: `verify:${spec.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ spec: spec.key, build, verdict }))
  }
)
const verticals = built.filter(Boolean)
const passed = verticals.filter((v) => v.verdict?.numericallyCorrect && v.build?.testsPassing !== false)
log(`Build+Verify: ${passed.length}/${verticals.length} verticals passed adversarial review.`)

// PHASE 2 — CHAIN
phase('Chain')
log('Wiring auto-synthesis + funnel plot into the workbench + nav + authoritative tsc/tests…')
const integration = await agent(
  `${REPO}\n\nINTEGRATE round 6 coherently and keep the app green.
1. In app/console/workbench/page.tsx (and _components), add a "Load from cached sources" mode:
   a text input for comma-separated source IDs (or reuse an existing source picker if one
   exists) that POSTs to /api/auto-synthesis and populates the studies from the returned
   report, showing which sources were skipped and why. Keep the existing manual-entry mode.
2. Where the evidence report / workbench shows publication bias, render
   components/synthesis/FunnelPlot.tsx using the funnel data (compute it via
   lib/publicationBias.ts funnelPlotData from the pooled studies), and show
   components/synthesis/HeterogeneityBar.tsx for I^2.
3. Nav: no new page needed (workbench already linked). If you add a standalone auto-synthesis
   page, link it under "Research"; otherwise skip nav edits.
4. Run \`npx tsc --noEmit\` and fix type errors in this round's files; run \`npx vitest run\` and
   fix genuine breakage (fix wrong CODE, not correct tests).
Report: tsc pass/fail, vitest counts, and every file edited. Be honest if anything is red.`,
  { label: 'integrate:workbench-sources', phase: 'Chain', effort: 'high' }
)

// PHASE 3 — HARDEN
phase('Harden')
log('Hardening remaining backlog…')
const harden = await agent(
  `${REPO}\n\nHARDEN with MINIMAL correct edits. Do NOT touch owner-reserved files:
${RESERVED.join(', ')}.
Targets (address what genuinely applies; do not invent changes):
1. Any org-scoped route trusting client org_id or missing an org_id predicate; any mutation
   route missing requireRole.
2. Any public route missing rate limiting / try-catch, or LLM JSON parsed without Zod.
3. Confirm /api/auto-synthesis loads sources with the correct scoping (org vs public) matching
   /api/sources.
Run \`npx tsc --noEmit\` and \`npx vitest run\`; report results honestly with the exact files
edited. If clean on a target, say so.`,
  { label: 'harden:scoping', phase: 'Harden', effort: 'high' }
)

// PHASE 4 — REPORT
phase('Report')
return {
  round: 6,
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

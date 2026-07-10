export const meta = {
  name: 'build-eval',
  description: 'Build the proof layer — a rigorous, runnable benchmark of PaperTrail verification against the real SciFact dataset (SUPPORT/CONTRADICT/NEI), comparing PaperTrail (Claude + deterministic engine) vs a Claude-alone baseline vs digested MiniCheck, with precision/recall/F1 metrics and a methodology doc. Numbers elite judges respect.',
  whenToUse: 'To produce the measured credibility artifact: how well PaperTrail verifies scientific claims vs baselines, on an external labeled benchmark.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint: metrics lib, SciFact loader + committed fixture, benchmark runner + docs' },
    { title: 'Verify', detail: 'tsc + the metrics oracle test' },
    { title: 'Report', detail: 'how to run + what it measures' },
  ],
}

const CTX = `PaperTrail verifies scientific/clinical claims against primary sources with a deterministic
engine (NO LLM in the numeric loop) + Claude for extraction/reasoning. Build a RUNNABLE benchmark that
MEASURES how well it does, on the real SciFact dataset already downloaded (gitignored) at
reference/scifact/data/: claims_{train,dev,test}.jsonl and corpus.jsonl. SciFact claim shape:
{ id, claim, evidence:{ doc_id:[{sentences:[int], label:'SUPPORT'|'CONTRADICT'}] }, cited_doc_ids:[int] };
empty evidence = NOT_ENOUGH_INFO (NEI). corpus doc: { doc_id, title, abstract:[sentence,...] }.

Map SciFact -> PaperTrail: the cited corpus doc(s) are the SOURCE (raw_text = title + abstract joined);
gold label = SUPPORT | CONTRADICT | NEI. PaperTrail's verdict maps to a predicted label (SUPPORT when it
finds the source supports the claim / discrepancy_type 'accurate'; CONTRADICT when it flags a
distortion; NEI when no_support_found / no confident match). Keep everything typed + Zod where it crosses
a boundary. This is a dev/eval harness (scripts + lib/eval), not a deployed route — reading reference/ at
eval time is fine, but ALSO commit a small curated subset so it runs without the gitignored data.`

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['area', 'filesWritten', 'runnable', 'summary'],
  properties: {
    area: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    runnable: { type: 'boolean' }, summary: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['tscPass', 'metricsTestPass', 'testTotals', 'filesEdited', 'notes'],
  properties: {
    tscPass: { type: 'boolean' }, metricsTestPass: { type: 'boolean' }, testTotals: { type: 'string' },
    filesEdited: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}

const PARTS = [
  {
    key: 'metrics', label: 'eval:metrics-lib',
    prompt: CTX + `

BUILD the metrics library (pure, deterministic, fully unit-testable NOW without any API/DB). Own ONLY:
lib/eval/metrics.ts and tests/evalMetrics.test.ts.
lib/eval/metrics.ts exports: confusionMatrix(pairs:[{gold,pred}], labels) ; perClassPRF(matrix) ->
{label, precision, recall, f1, support}[] ; macroF1 / microF1 / accuracy ; and a formatMetricsTable(...)
that renders a markdown table. Labels are 'SUPPORT'|'CONTRADICT'|'NEI'. Handle zero-division (0, not NaN).
tests/evalMetrics.test.ts: ORACLE test on a hand-computed confusion matrix (assert exact precision/recall/
f1/accuracy for a small fixed set of gold/pred pairs). Keep it tight.`,
  },
  {
    key: 'loader', label: 'eval:scifact-loader',
    prompt: CTX + `

BUILD the SciFact loader + a COMMITTED curated subset (so the bench runs without the gitignored data).
Own ONLY: scripts/benchmark/scifact.ts, tests/fixtures/scifact-sample.json, lib/eval/benchmarkTypes.ts.
lib/eval/benchmarkTypes.ts: the BenchmarkCase type { id, claim, sourceText, goldLabel:'SUPPORT'|'CONTRADICT'
|'NEI', citedDocIds } + a Zod schema.
scripts/benchmark/scifact.ts: loadScifact({ split, limit, dataDir? }) — read reference/scifact/data/claims_
<split>.jsonl + corpus.jsonl, join each claim to its cited corpus doc(s) (raw_text = title + '\\n' +
abstract.join(' ')), derive goldLabel (SUPPORT/CONTRADICT from evidence labels; NEI when evidence is empty),
return BenchmarkCase[]. Also loadSample() reading the committed tests/fixtures/scifact-sample.json.
Curate tests/fixtures/scifact-sample.json NOW by reading reference/scifact/data: ~60 balanced BenchmarkCase
rows (mix of SUPPORT/CONTRADICT/NEI) with their joined sourceText inlined, so it is self-contained and
committed. Validate it against the Zod schema in a tiny check. Keep the fixture reasonably sized.`,
  },
  {
    key: 'runner', label: 'eval:benchmark-runner',
    prompt: CTX + `

BUILD the benchmark runner + methodology doc. Own ONLY: scripts/benchmark/run.ts, docs/benchmark.md.
(You may READ lib/eval/metrics.ts, scripts/benchmark/scifact.ts, lib/eval/benchmarkTypes.ts — being built
in parallel — for their signatures; import them, do not edit them.)
scripts/benchmark/run.ts: for each BenchmarkCase, produce a predicted label from THREE systems and score
each with the metrics lib:
  (1) PaperTrail — run the real verification path (extraction + verification + deterministic reconcile via
      lib/effectSize / lib/structuredVerification) against the case's sourceText; map its verdict to
      SUPPORT/CONTRADICT/NEI.
  (2) Claude-alone baseline — a single Claude call (lib/claude callClaudeForJson + Zod) that classifies
      the claim vs source WITHOUT the deterministic engine.
  (3) MiniCheck (optional) — via lib/engines/minicheck factCheck when MINICHECK_ENABLED; supported->SUPPORT
      else CONTRADICT/NEI. Skip gracefully if disabled.
Compute per-class + macro/micro F1 + accuracy for each system, print a comparison table, and WRITE it to
docs/benchmark.md (with a RESULTS section that the run fills in, plus a fixed METHODOLOGY section:
dataset, mapping, metrics, how to run). Add an npm script "bench": "tsx scripts/benchmark/run.ts" to
package.json (edit package.json ONLY to add that one script line). Default to loadSample() (committed) so
it runs offline for the harness; --full uses loadScifact(dev). Guard missing ANTHROPIC_API_KEY with a clear
message. Do NOT run it (needs keys); make it correct and runnable.`,
  },
]

// PHASE 1 — BUILD (parallel disjoint)
phase('Build')
log('Building the proof layer: metrics lib, SciFact loader + fixture, benchmark runner + docs…')
const parts = await parallel(
  PARTS.map((p) => () => agent(CTX + '\n\n' + p.prompt, { label: p.label, phase: 'Build', schema: RESULT_SCHEMA, effort: 'high' }).then((r) => ({ key: p.key, r })))
)
const done = parts.filter(Boolean)
log('Built ' + done.length + ' parts of the eval harness.')

// PHASE 2 — VERIFY
phase('Verify')
const verify = await agent(
  CTX + `

VERIFY the eval harness. Run npx tsc --noEmit and npx vitest run tests/evalMetrics.test.ts (the metrics
oracle). Confirm scripts/benchmark/run.ts and scripts/benchmark/scifact.ts type-check and their imports
resolve, tests/fixtures/scifact-sample.json parses + validates against the Zod schema, and package.json has
the "bench" script. Fix minimal type errors in the new eval files only. Report tscPass, metricsTestPass,
testTotals, files edited. Do NOT run the full benchmark (needs API keys). Be honest about any red.`,
  { label: 'verify:eval', phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' }
)

// PHASE 3 — REPORT
phase('Report')
return {
  parts: done.map((d) => ({ area: d.key, files: d.r?.filesWritten || [], runnable: d.r?.runnable ?? null, summary: d.r?.summary || '' })),
  verify,
  howToRun: 'npm run bench   (offline committed sample)   |   npm run bench -- --full   (SciFact dev, needs reference/scifact/data + ANTHROPIC_API_KEY)',
}

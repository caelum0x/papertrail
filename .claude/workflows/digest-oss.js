export const meta = {
  name: 'digest-oss',
  description: 'Digest the cloned MIT/Apache OSS engines INTO PaperTrail as first-class polyglot backends (Docling-style subprocess, not HTTP, not reference) — paper-qa, STORM, ASReview, MiniCheck, PyMARE, pyalex. Each becomes a python/<engine>/run.py + lib/engines/<engine>.ts bridge with graceful TS fallback.',
  whenToUse: 'To build PaperTrail ON the cloned OSS repos — genuine digestion of their engines into the codebase, the way Linux realized Unix\'s design as its own foundation.',
  phases: [
    { title: 'Digest', detail: 'per engine: read reference/<repo>, write python wrapper + TS bridge + minimal test' },
    { title: 'Verify', detail: 'python py_compile + tsc + bridge tests; confirm real code, graceful fallback' },
    { title: 'Report', detail: 'digested engines + how each is wired next' },
  ],
}

const PATTERN = `PaperTrail digests OSS engines via the EXISTING Docling polyglot pattern — a DIRECT
subprocess, NOT an HTTP service, NOT reference-only. Mirror these two files exactly:

PYTHON CONTRACT (like python/document_ai/docling_extract.py): a script that reads its input
(argv or stdin JSON), does the work using the real OSS library, and prints a single JSON object to
stdout: { "ok": true, ...result } on success, { "ok": false, "error": "Type: msg" } on failure.
Catch all exceptions and surface them as JSON. Exit 0 on ok, 1 on handled error, 2 on usage error.

TS BRIDGE (like lib/ingestion/docling.ts): spawn(PYTHON_BIN, [SCRIPT, ...]) from node:child_process,
collect stdout, JSON.parse it, resolve on ok / reject otherwise; bounded by a timeout (SIGKILL);
opt-in via an env flag (e.g. PAPERQA_ENABLED==='true'); a typed Result interface. The bridge NEVER
throws to the route — it rejects so the caller can fall back to the existing TS+Claude path. PYTHON_BIN
= process.env.PYTHON_BIN || 'python3'. SCRIPT = path.join(process.cwd(),'python','<engine>','run.py').

Read the cloned source in reference/<repo> to get the REAL library API (entry points, function names,
return shapes) — do not guess. Each engine is OPT-IN and optional (graceful fallback), like Docling.
Small files, explicit error handling, never log claim/question/abstract text.`

const DIGEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'filesWritten', 'pythonEntry', 'bridgeExport', 'realApiUsed', 'summary'],
  properties: {
    engine: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    pythonEntry: { type: 'string', description: 'the real OSS library function/class the wrapper calls' },
    bridgeExport: { type: 'string' }, realApiUsed: { type: 'boolean', description: 'true if it calls the actual library, not a stub' },
    summary: { type: 'string' }, envFlag: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'callsRealLibrary', 'followsContract', 'gracefulFallback', 'issues'],
  properties: {
    engine: { type: 'string' },
    callsRealLibrary: { type: 'boolean' }, followsContract: { type: 'boolean' }, gracefulFallback: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const ENGINES = [
  {
    key: 'paperqa', label: 'digest:paper-qa',
    prompt: `Engine: paper-qa (FutureHouse PaperQA2, Apache-2.0), cloned at reference/paper-qa.
DIGEST it as PaperTrail's agentic paper-QA backend. Own ONLY: python/paperqa/run.py,
python/paperqa/requirements.txt, lib/engines/paperqa.ts, tests/paperqaBridge.test.ts.
Read reference/paper-qa (its README + paperqa/ package) for the real API (e.g. the ask/agent_query
entry, Docs.add/aquery, Settings). run.py: read stdin JSON { question, texts:[{name,text}] | paths },
build the paper-qa Docs from the provided texts, run its query, print { ok, answer, contexts:[{text,
name,score}], references } (contexts must be the actual retrieved passages so PaperTrail can ground
them). lib/engines/paperqa.ts: askPaperQa(input, timeoutMs?) -> typed Result; env flag PAPERQA_ENABLED.
requirements.txt: paper-qa (pin a version). Test: the TS bridge's parse + disabled/fallback logic
(mock, do not run python). Report realApiUsed.`,
  },
  {
    key: 'storm', label: 'digest:storm',
    prompt: `Engine: STORM / knowledge-storm (Stanford OVAL, MIT), cloned at reference/storm.
DIGEST it as PaperTrail's long-form cited-synthesis backend. Own ONLY: python/storm/run.py,
python/storm/requirements.txt, lib/engines/storm.ts, tests/stormBridge.test.ts.
Read reference/storm (knowledge_storm package, the STORMWikiRunner / Engine + lm/rm config) for the
real API. run.py: read stdin JSON { topic, sources? }, run STORM's outline+article generation
(configure it to use the provided sources / a retrieval fn where possible), print { ok, outline,
article, citations:[{title,url}] }. Keep model/config via env so PaperTrail can point it at Anthropic.
lib/engines/storm.ts: generateStormArticle(input, timeoutMs?) -> typed Result; env flag STORM_ENABLED.
Test the bridge's parse/fallback (mock). Report realApiUsed.`,
  },
  {
    key: 'asreview', label: 'digest:asreview',
    prompt: `Engine: ASReview (Apache-2.0), cloned at reference/asreview.
DIGEST it as PaperTrail's active-learning screening-ranker backend. Own ONLY: python/asreview/run.py,
python/asreview/requirements.txt, lib/engines/asreview.ts, tests/asreviewBridge.test.ts.
Read reference/asreview for the real API (asreview models/query strategies / the ASReview simulate or
the underlying sklearn-based active learner). run.py: read stdin JSON { records:[{id,title,abstract}],
labeled:[{id,label(0|1)}] }, train the active learner on labeled records, score the unlabeled ones,
print { ok, ranking:[{id, relevance}] } sorted most-relevant-first. If ASReview's high-level API is too
heavy, use its underlying feature-extraction + naive-bayes/logistic active-learning core (documented in
the repo). lib/engines/asreview.ts: rankRecords(input, timeoutMs?) -> typed Result; env flag
ASREVIEW_ENABLED. Test bridge parse/fallback (mock). Report realApiUsed.`,
  },
  {
    key: 'minicheck', label: 'digest:minicheck',
    prompt: `Engine: MiniCheck (MIT), cloned at reference/MiniCheck.
DIGEST it as PaperTrail's grounded fact-check backend (complements lib/grounding.ts: grounding checks
verbatim spans, MiniCheck checks entailment of a claim by a document). Own ONLY: python/minicheck/run.py,
python/minicheck/requirements.txt, lib/engines/minicheck.ts, tests/minicheckBridge.test.ts.
Read reference/MiniCheck for the real API (the MiniCheck class / model.score(docs=[...], claims=[...])).
run.py: read stdin JSON { pairs:[{claim, doc}] }, run MiniCheck, print { ok, results:[{claim, supported
(bool), score(0..1)}] }. Default to the small/CPU-friendly model variant via env. lib/engines/minicheck.ts:
factCheck(input, timeoutMs?) -> typed Result; env flag MINICHECK_ENABLED. Test bridge parse/fallback
(mock). Report realApiUsed.`,
  },
  {
    key: 'pymare', label: 'digest:pymare',
    prompt: `Engine: PyMARE (neurostuff, MIT), cloned at reference/PyMARE.
DIGEST it as PaperTrail's reference meta-analysis backend — an independent cross-check of our TS
lib/metaAnalysis.ts (production oracle). Own ONLY: python/pymare/run.py, python/pymare/requirements.txt,
lib/engines/pymare.ts, tests/pymareBridge.test.ts.
Read reference/PyMARE for the real API (pymare.Dataset + estimators: DerSimonianLaird, WeightedLeastSquares,
combine). run.py: read stdin JSON { yi:[], vi:[] }, fit fixed + DL random effects, print { ok, fixed:
{estimate, se, ciLower, ciUpper}, random:{estimate, se, ciLower, ciUpper, tau2}, q, i2 }. lib/engines/
pymare.ts: pooledPyMARE(input, timeoutMs?) -> typed Result; env flag PYMARE_ENABLED. Test bridge parse/
fallback (mock). Report realApiUsed.`,
  },
  {
    key: 'openalex', label: 'digest:pyalex-openalex',
    prompt: `Engine: pyalex (OpenAlex client, MIT), cloned at reference/pyalex.
DIGEST it to broaden PaperTrail's source ingestion beyond PubMed/ClinicalTrials.gov to the whole
OpenAlex corpus. Own ONLY: python/openalex/run.py, python/openalex/requirements.txt,
lib/engines/openalex.ts, tests/openalexBridge.test.ts.
Read reference/pyalex for the real API (pyalex.Works().search(...).get(), config.email). run.py: read
stdin JSON { query, limit }, query OpenAlex Works, print { ok, works:[{openalex_id, title, abstract
(reconstruct from abstract_inverted_index), doi, year, cited_by_count, is_retracted}] } — reconstruct the
abstract from OpenAlex's inverted index. lib/engines/openalex.ts: searchOpenAlex(input, timeoutMs?) ->
typed Result; env flag OPENALEX_ENABLED (and pass OPENALEX_EMAIL through for the polite pool). Test bridge
parse/fallback (mock). Report realApiUsed.`,
  },
]

// PHASE 1 — DIGEST -> VERIFY (pipelined, disjoint files, safe alongside other workflows)
phase('Digest')
log('Digesting 6 OSS engines into python/ + lib/engines/ (Docling-style subprocess) …')
const digested = await pipeline(
  ENGINES,
  (e) => agent(PATTERN + '\n\n' + e.prompt, { label: e.label, phase: 'Digest', schema: DIGEST_SCHEMA, effort: 'high' }),
  (build, e) => {
    if (!build) return { engine: e.key, build: null, verdict: null }
    return agent(
      PATTERN + '\n\nADVERSARIALLY VERIFY the "' + e.key + '" digestion. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm: (1) callsRealLibrary — run.py imports and calls the ACTUAL OSS library from reference/` + e.key + ` (not a
stub/mock); check the import + entry function against the real repo API. (2) followsContract — JSON in / single
JSON out with ok+error, exit codes, all exceptions caught. (3) gracefulFallback — the TS bridge rejects (never
throws to the route), is env-gated, and is timeout-bounded. Run "python3 -m py_compile" on the wrapper if a
python3 is present; run the bridge test. Put real problems in issues as 'blocker'. Default booleans to false if
unconfirmed.`,
      { label: 'verify:' + e.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ engine: e.key, build, verdict }))
  }
)
const results = digested.filter(Boolean)
const solid = results.filter((r) => r.verdict?.callsRealLibrary && r.verdict?.followsContract && r.verdict?.gracefulFallback)
log('Digested ' + solid.length + '/' + results.length + ' engines calling the real library with graceful fallback.')

// PHASE 2 — REPORT
phase('Report')
return {
  engines: results.map((r) => ({
    engine: r.engine, files: r.build?.filesWritten || [], pythonEntry: r.build?.pythonEntry || '',
    bridgeExport: r.build?.bridgeExport || '', envFlag: r.build?.envFlag || '',
    callsRealLibrary: r.verdict?.callsRealLibrary ?? null, gracefulFallback: r.verdict?.gracefulFallback ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  solid: solid.length, total: results.length,
  wiringNext: [
    'paperqa -> back /api/paper-qa (try engine, fall back to TS+Claude)',
    'storm -> back /api/synthesis-report',
    'asreview -> back /api/screening/ai-rank',
    'minicheck -> add as a second grounding check in the verify/evidence path',
    'pymare -> cross-check lib/metaAnalysis output (production oracle)',
    'openalex -> add as a source in lib/ingest/searchAndCache',
  ],
}

export const meta = {
  name: 'digest-bio-oss',
  description: 'Digest permissive biomedical-KG OSS into PaperTrail as first-class polyglot engines (Docling-style subprocess, not HTTP, not reference): INDRA (mechanistic causal statement assembly with belief + provenance), scispaCy (biomedical NER + UMLS entity linking), PyKEEN (knowledge-graph link prediction for repurposing hypotheses), pytrials (ClinicalTrials.gov structured client). Each = python/<engine>/run.py + lib/engines/<engine>.ts bridge with graceful TS fallback.',
  whenToUse: 'Build the enterprise evidence platform ON proven OSS: mechanism assembly, entity linking, and KG link prediction.',
  phases: [
    { title: 'Digest', detail: 'per engine: read reference/<repo>, write python wrapper + TS bridge + minimal test' },
    { title: 'Verify', detail: 'py_compile + tsc + bridge tests; real library, graceful fallback' },
    { title: 'Report', detail: 'digested engines + how each feeds the platform' },
  ],
}

const PATTERN = `Digest OSS engines via the EXISTING Docling polyglot pattern — a DIRECT subprocess, NOT an
HTTP service, NOT reference-only. Mirror these two files EXACTLY:
- PYTHON (like python/document_ai/docling_extract.py + python/paperqa/run.py): reads stdin JSON, calls the
  REAL OSS library, prints ONE JSON object to stdout: { "ok": true, ...result } or { "ok": false, "error":
  "Type: msg" }; catch all exceptions -> JSON; exit 0/1/2 (ok/handled/usage). Text over STDIN never argv.
- TS BRIDGE (like lib/ingestion/docling.ts + lib/engines/paperqa.ts): spawn(PYTHON_BIN||'python3',
  [SCRIPT]) from node:child_process, SCRIPT = path.join(process.cwd(),'python','<engine>','run.py'); collect
  stdout, JSON.parse, resolve on ok / reject otherwise; timeout with SIGKILL; opt-in via an env flag; typed
  Result interface; NEVER throws to the caller (rejects so callers fall back). Never logs claim text.
READ the cloned source in reference/<repo> for the REAL API (entry points, return shapes) — do not guess.
Each engine is OPT-IN + optional (graceful fallback), like Docling. Add python/<engine>/requirements.txt.`

const DIGEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'filesWritten', 'pythonEntry', 'bridgeExport', 'realApiUsed', 'summary'],
  properties: {
    engine: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    pythonEntry: { type: 'string' }, bridgeExport: { type: 'string' }, realApiUsed: { type: 'boolean' },
    summary: { type: 'string' }, envFlag: { type: 'string' }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'callsRealLibrary', 'followsContract', 'gracefulFallback', 'issues'],
  properties: {
    engine: { type: 'string' }, callsRealLibrary: { type: 'boolean' }, followsContract: { type: 'boolean' },
    gracefulFallback: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const ENGINES = [
  {
    key: 'indra', label: 'digest:indra',
    prompt: `Engine: INDRA (Sorger Lab, BSD-2), cloned at reference/indra. The crown jewel: assembles
MECHANISTIC CAUSAL statements (Agent A activates/inhibits/phosphorylates B) with a belief score + evidence
provenance, from natural-language text and from curated pathway databases. DIGEST it as PaperTrail's
mechanism-assembly engine. Own ONLY: python/indra/run.py, python/indra/requirements.txt,
lib/engines/indra.ts, tests/indraBridge.test.ts.
Read reference/indra (indra/sources, indra/statements, the api). run.py: read stdin JSON { text? , genes? }.
For text -> use INDRA's text reading path that does NOT require a paid reader if available (e.g. the REACH
web service via indra.sources.reach or the offline eidos/trips is optional) — prefer indra.sources that hit
free web services; degrade to { ok:false } cleanly if none configured. For a list of genes -> query a free
pathway source (e.g. indra.sources.pathway_commons / indra.databases) for statements involving them. Return
{ ok, statements:[{ type, subj, obj, belief, evidence:[{source, text, pmid}] }] } from
INDRA Statements (stmt.to_json()). Keep the reader choice env-driven.
lib/engines/indra.ts: assembleMechanisms(input, timeoutMs?) -> typed Result; env flag INDRA_ENABLED. Test
the bridge's parse/fallback with a mocked spawn. Report realApiUsed (imports the actual indra package).`,
  },
  {
    key: 'scispacy', label: 'digest:scispacy',
    prompt: `Engine: scispaCy (AllenAI, Apache-2.0), cloned at reference/scispacy. Biomedical NER + entity
linking to UMLS CUIs. DIGEST it as PaperTrail's high-precision biomedical entity linker (complements
PubTator). Own ONLY: python/scispacy/run.py, python/scispacy/requirements.txt, lib/engines/scispacy.ts,
tests/scispacyBridge.test.ts.
Read reference/scispacy (the EntityLinker abbreviation/linking components, README model names). run.py: read
stdin JSON { text }, load a scispacy model (env SCISPACY_MODEL default en_core_sci_sm) + the UMLS/MeSH
EntityLinker, and return { ok, entities:[{ text, label, start, end, umlsCui, canonicalName, score }] }.
Document that the model must be pip-installed (its wheel URL) in requirements.txt. lib/engines/scispacy.ts:
linkEntities(text, timeoutMs?) -> typed Result; env flag SCISPACY_ENABLED. Test bridge parse/fallback
(mock spawn). Report realApiUsed.`,
  },
  {
    key: 'pykeen', label: 'digest:pykeen',
    prompt: `Engine: PyKEEN (MIT), cloned at reference/pykeen. Knowledge-graph embedding + LINK PREDICTION —
score plausible novel (head, relation, tail) triples, i.e. repurposing / novel-association hypotheses over
PaperTrail's evidence graph. DIGEST it. Own ONLY: python/pykeen/run.py, python/pykeen/requirements.txt,
lib/engines/pykeen.ts, tests/pykeenBridge.test.ts.
Read reference/pykeen (pipeline(), TriplesFactory, model.predict / predict_target). run.py: read stdin JSON
{ triples:[[h,r,t],...], predict:{ head?, relation?, tail? }, model?, epochs? }. Train a SMALL fast model
(default TransE, few epochs, CPU) on the provided triples via pykeen.pipeline, then score the requested
prediction target, returning { ok, predictions:[{ head, relation, tail, score }] } ranked. Bound epochs
(env PYKEEN_EPOCHS default small) so a request can't run away. lib/engines/pykeen.ts: predictLinks(input,
timeoutMs?) -> typed Result (generous timeout); env flag PYKEEN_ENABLED. Test bridge parse/fallback (mock
spawn). Report realApiUsed.`,
  },
  {
    key: 'pytrials', label: 'digest:pytrials',
    prompt: `Engine: pytrials (MIT), cloned at reference/pytrials. A ClinicalTrials.gov client. DIGEST it as
a structured trial-landscape fetcher (richer than raw parsing). Own ONLY: python/pytrials/run.py,
python/pytrials/requirements.txt, lib/engines/pytrials.ts, tests/pytrialsBridge.test.ts.
Read reference/pytrials (ClinicalTrials class, get_study_fields / get_full_studies). run.py: read stdin JSON
{ query, fields?, max? }, query ClinicalTrials.gov via pytrials, return { ok, studies:[{ nctId, title,
status, phase, conditions, interventions, enrollment }] }. lib/engines/pytrials.ts: searchTrials(input,
timeoutMs?) -> typed Result; env flag PYTRIALS_ENABLED. Test bridge parse/fallback (mock spawn). Report realApiUsed.`,
  },
]

phase('Digest')
log('Digesting INDRA, scispaCy, PyKEEN, pytrials into python/ + lib/engines/ (Docling-style)…')
const digested = await pipeline(
  ENGINES,
  (e) => agent(PATTERN + '\n\n' + e.prompt, { label: e.label, phase: 'Digest', schema: DIGEST_SCHEMA, effort: 'high' }),
  (build, e) => {
    if (!build) return { engine: e.key, build: null, verdict: null }
    return agent(
      PATTERN + '\n\nADVERSARIALLY VERIFY the "' + e.key + '" digestion. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm: callsRealLibrary (run.py imports + calls the ACTUAL package from reference/` + e.key + `, not a stub;
check import + entry vs the real API), followsContract (JSON in / one JSON out with ok+error, exit codes, all
exceptions caught, text over stdin), gracefulFallback (TS bridge rejects not throws, env-gated, timeout-bounded).
Run "python3 -m py_compile" on the wrapper if python3 exists; run the bridge test. Put problems in issues as
'blocker'; default booleans false if unconfirmed.`,
      { label: 'verify:' + e.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ engine: e.key, build, verdict }))
  }
)
const results = digested.filter(Boolean)
const solid = results.filter((r) => r.verdict?.callsRealLibrary && r.verdict?.followsContract && r.verdict?.gracefulFallback)
log('Digested ' + solid.length + '/' + results.length + ' bio-KG engines (real library, graceful fallback).')

phase('Report')
return {
  engines: results.map((r) => ({
    engine: r.engine, files: r.build?.filesWritten || [], pythonEntry: r.build?.pythonEntry || '',
    bridgeExport: r.build?.bridgeExport || '', envFlag: r.build?.envFlag || '',
    callsRealLibrary: r.verdict?.callsRealLibrary ?? null, gracefulFallback: r.verdict?.gracefulFallback ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  solid: solid.length, total: results.length,
  feedsPlatform: [
    'indra -> knowledge graph mechanism edges + dossier mechanism section (belief + provenance)',
    'scispacy -> high-precision UMLS entity linking (complements PubTator in the KG + dossier)',
    'pykeen -> novel link prediction over the evidence graph (repurposing hypotheses)',
    'pytrials -> structured trial landscape for the dossier + RWE trial-maturity signal',
  ],
}

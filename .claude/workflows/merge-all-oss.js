export const meta = {
  name: 'merge-all-oss',
  description: 'Merge the remaining cloned OSS verification/KG backends INTO PaperTrail as polyglot engines (Docling-style subprocess): MultiVerS (scientific claim verification), Valsci (LLM scientific claim verification), Loki/OpenFactVerification (multi-step fact verification), BioCypher (biomedical knowledge-graph builder). Each = python/<engine>/run.py + lib/engines/<engine>.ts bridge with graceful fallback.',
  whenToUse: 'Ingest every remaining OSS backend under PaperTrail toward one unified engine surface.',
  phases: [
    { title: 'Digest', detail: 'per engine: read reference/<repo>, write python wrapper + TS bridge + minimal test' },
    { title: 'Verify', detail: 'py_compile + tsc + bridge tests; real library, graceful fallback' },
    { title: 'Report', detail: 'digested engines' },
  ],
}

const PATTERN = `Digest OSS engines via the EXISTING Docling polyglot pattern — a DIRECT subprocess, NOT HTTP,
NOT reference-only. Mirror python/document_ai/docling_extract.py + python/paperqa/run.py (python: read stdin
JSON, call the REAL library, print ONE JSON { ok:true,... } | { ok:false, error }, catch all, exit 0/1/2,
text over stdin never argv) and lib/ingestion/docling.ts + lib/engines/paperqa.ts (TS bridge: spawn(
PYTHON_BIN||'python3',[SCRIPT]), SCRIPT=path.join(process.cwd(),'python','<engine>','run.py'), JSON.parse,
resolve-on-ok/reject-otherwise, timeout+SIGKILL, opt-in env flag, typed Result, NEVER throws to caller).
READ reference/<repo> for the REAL API — do not guess. Opt-in + optional (graceful fallback). Add
python/<engine>/requirements.txt. Never log claim text.`

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
    key: 'multivers', label: 'digest:multivers',
    prompt: `Engine: MultiVerS (Wadden et al., Apache-2.0), cloned at reference/multivers. Scientific claim
verification — predicts SUPPORTS / REFUTES / NEI for a claim against an abstract + selects rationale
sentences (trained on SciFact/HealthVer/CovidFact). DIGEST it. Own ONLY: python/multivers/run.py,
python/multivers/requirements.txt, lib/engines/multivers.ts, tests/multiversBridge.test.ts.
Read reference/multivers (multivers/model, the predict entrypoint, checkpoint loading). run.py: read stdin
JSON { claim, abstractSentences:[...] }, run the model's predict to return { ok, label: SUPPORTS|REFUTES|
NEI, rationaleSentences:[int], score }. Document the checkpoint download in requirements/comments (env
MULTIVERS_CKPT). lib/engines/multivers.ts: verifyScientificClaim(input, timeoutMs?) -> typed Result; env
flag MULTIVERS_ENABLED. Test bridge parse/fallback (mock spawn). Report realApiUsed.`,
  },
  {
    key: 'valsci', label: 'digest:valsci',
    prompt: `Engine: Valsci (MIT), cloned at reference/Valsci. A self-hostable scientific claim verification
tool (LLM + literature). DIGEST its verification core. Own ONLY: python/valsci/run.py,
python/valsci/requirements.txt, lib/engines/valsci.ts, tests/valsciBridge.test.ts.
Read reference/Valsci (its claim-processing / scoring pipeline entrypoint). run.py: read stdin JSON { claim }
(and optional provided papers), run Valsci's verification to return { ok, verdict, confidence, rationale,
references:[...] }. If Valsci requires its own LLM/API keys, read them from env and degrade to { ok:false }
cleanly when absent. lib/engines/valsci.ts: valsciVerify(input, timeoutMs?) -> typed Result; env flag
VALSCI_ENABLED. Test bridge parse/fallback (mock spawn). Report realApiUsed.`,
  },
  {
    key: 'loki', label: 'digest:loki-factcheck',
    prompt: `Engine: Loki / OpenFactVerification (Libr-AI, MIT), cloned at reference/OpenFactVerification.
Multi-step fact verification: decompose -> check-worthiness -> query -> retrieve evidence -> verdict.
DIGEST it. Own ONLY: python/loki/run.py, python/loki/requirements.txt, lib/engines/loki.ts,
tests/lokiBridge.test.ts.
Read reference/OpenFactVerification (the factcheck pipeline / solvers). run.py: read stdin JSON { text },
run the pipeline to return { ok, claims:[{ claim, checkworthy, verdict, evidence:[...] }], overallFactuality }.
If it needs a serper/search or LLM key, read from env; degrade to { ok:false } cleanly when absent.
lib/engines/loki.ts: factVerify(input, timeoutMs?) -> typed Result; env flag LOKI_ENABLED. Test bridge
parse/fallback (mock spawn). Report realApiUsed.`,
  },
  {
    key: 'biocypher', label: 'digest:biocypher',
    prompt: `Engine: BioCypher (MIT), cloned at reference/biocypher. A framework for building biomedical
knowledge graphs from schema + adapters. DIGEST a focused capability: normalize a set of (subject, relation,
object) biomedical triples to a BioCypher/Biolink-typed, ontology-mapped graph fragment. Own ONLY:
python/biocypher/run.py, python/biocypher/requirements.txt, lib/engines/biocypher.ts,
tests/biocypherBridge.test.ts.
Read reference/biocypher (BioCypher core, the ontology/schema mapping). run.py: read stdin JSON
{ triples:[[subjType,subjId,rel,objType,objId],...] }, use BioCypher to map entity types/relations to the
Biolink model and return { ok, nodes:[{id,type,biolink}], edges:[{subj,rel,obj,biolink}] }. lib/engines/
biocypher.ts: normalizeGraph(input, timeoutMs?) -> typed Result; env flag BIOCYPHER_ENABLED. Test bridge
parse/fallback (mock spawn). Report realApiUsed.`,
  },
]

phase('Digest')
log('Merging MultiVerS, Valsci, Loki, BioCypher into python/ + lib/engines/…')
const digested = await pipeline(
  ENGINES,
  (e) => agent(PATTERN + '\n\n' + e.prompt, { label: e.label, phase: 'Digest', schema: DIGEST_SCHEMA, effort: 'high' }),
  (build, e) => {
    if (!build) return { engine: e.key, build: null, verdict: null }
    return agent(
      PATTERN + '\n\nADVERSARIALLY VERIFY the "' + e.key + '" digestion. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm callsRealLibrary (imports+calls the ACTUAL package from reference/), followsContract (JSON in / one
JSON out, exit codes, all exceptions caught, stdin not argv), gracefulFallback (TS bridge rejects not throws,
env-gated, timeout-bounded). py_compile the wrapper if python3 exists; run the bridge test. Problems ->
issues 'blocker'; default booleans false if unconfirmed.`,
      { label: 'verify:' + e.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ engine: e.key, build, verdict }))
  }
)
const results = digested.filter(Boolean)
const solid = results.filter((r) => r.verdict?.callsRealLibrary && r.verdict?.followsContract && r.verdict?.gracefulFallback)
log('Merged ' + solid.length + '/' + results.length + ' OSS backends (real library, graceful fallback).')

phase('Report')
return {
  engines: results.map((r) => ({
    engine: r.engine, files: r.build?.filesWritten || [], envFlag: r.build?.envFlag || '',
    callsRealLibrary: r.verdict?.callsRealLibrary ?? null, gracefulFallback: r.verdict?.gracefulFallback ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  solid: solid.length, total: results.length,
}

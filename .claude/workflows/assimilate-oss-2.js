export const meta = {
  name: 'assimilate-oss-2',
  description: 'Assimilate the remaining OSS in backend/engines/ into native PaperTrail TypeScript on our stack: scispaCy (biomedical NER + entity linking), pyalex (native OpenAlex client), PyMARE (extra meta-analysis estimators), paper-qa (contextual reranking), MiniCheck (native entailment check), STORM (outline-then-write synthesis), Valsci (claim scoring). No Python, no HTTP, no vendor — owned native code using our DB/API/frontend.',
  whenToUse: 'Finish porting the OSS codebases into PaperTrail as native features.',
  phases: [
    { title: 'Port', detail: 'per OSS: read backend/engines/<name>, port core to native TS on our stack' },
    { title: 'Verify', detail: 'adversarial: faithful native port? uses our stack? tsc + tests green?' },
    { title: 'Report', detail: 'assimilated features' },
  ],
}

const CTX = `PaperTrail — Next.js 16 (App Router, TS strict) + Postgres/pgvector + Anthropic Claude. ASSIMILATE
open-source (MIT/BSD/Apache — WE OWN THEM) into PaperTrail as NATIVE features. OSS source is in
backend/engines/<name> (read it to port the REAL algorithm). HARD RULES: NO Python, NO subprocess, NO HTTP
to a service, NO vendor — PORT into NATIVE TypeScript in lib/. Use CLAUDE (lib/claude.ts: getClaude,
CLAUDE_MODEL, callClaudeForJson + Zod) only for the step the OSS did with a trained model; keep deterministic
parts native TS reusing lib/stats/distributions. USE OUR STACK: lib/db (getPool) + db/migrations when state
needed; retrieval via lib/agents/retrievalAgent over the cached sources table + lib/embeddings; grounding via
lib/grounding; serve via app/api/<feature>/route.ts (nodejs, checkRateLimit, Zod, ok/fail envelope, never log
claim text); console via app/console (house Tailwind, reuse components/console/StateBanners). Pure/immutable;
small files; explicit errors. Each vertical owns ONLY its listed files (disjoint).`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['feature', 'sourceOss', 'filesWritten', 'nativeTs', 'summary'],
  properties: {
    feature: { type: 'string' }, sourceOss: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    nativeTs: { type: 'boolean' }, summary: { type: 'string' },
    publicExports: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['feature', 'faithfulPort', 'nativeNoPython', 'tested', 'issues'],
  properties: {
    feature: { type: 'string' }, faithfulPort: { type: 'boolean' }, nativeNoPython: { type: 'boolean' }, tested: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const VERTICALS = [
  {
    key: 'ner', label: 'assimilate:scispacy',
    prompt: CTX + `

ASSIMILATE scispaCy (backend/engines/scispacy) — port biomedical NER + entity linking to native TS. Own ONLY:
lib/entities/ner.ts, lib/entities/schemas.ts, app/api/entities/route.ts, tests/ner.test.ts.
Read backend/engines/scispacy (its EntityLinker maps mentions to UMLS/MeSH CUIs; abbreviation detection).
Port NATIVELY: Claude does the NER + candidate mention extraction (callClaudeForJson+Zod: gene/disease/
chemical/variant spans), then a native TS linker maps each mention to a normalized id using a documented
in-code dictionary of common biomedical entities (extend as needed) + GROUND each mention span to the input
via lib/grounding (drop ungroundable). Public route { text } -> linked entities with normalized ids + offsets.
tests: assert grounding drop + linking over mocked Claude.`,
  },
  {
    key: 'openalex', label: 'assimilate:pyalex',
    prompt: CTX + `

ASSIMILATE pyalex (backend/engines/pyalex) — port a NATIVE OpenAlex REST client to broaden sources beyond
PubMed/ClinicalTrials.gov. Own ONLY: lib/sources/openalex.ts, app/api/sources/openalex/route.ts,
tests/openalexSource.test.ts.
Read backend/engines/pyalex (Works().search().get(), abstract_inverted_index reconstruction, polite pool
email). Port NATIVELY in TS (fetch): searchOpenAlex({ query, limit }, deps?) hitting the OpenAlex Works API,
reconstruct the abstract from abstract_inverted_index, return normalized [{ openalexId, title, abstract, doi,
year, citedByCount, isRetracted }]. Injectable fetch for offline tests. Public route. tests: over a mocked
OpenAlex response assert abstract reconstruction from the inverted index + normalized mapping.`,
  },
  {
    key: 'metaEstimators', label: 'assimilate:pymare',
    prompt: CTX + `

ASSIMILATE PyMARE (backend/engines/PyMARE) — port its EXTRA meta-analysis estimators natively (our
lib/metaAnalysis has DerSimonian-Laird; do NOT edit it). Own ONLY: lib/metaEstimators.ts,
tests/metaEstimators.test.ts.
Read backend/engines/PyMARE (estimators.py: WeightedLeastSquares, DerSimonianLaird, Hedges, VarianceBased/
tau2 methods). Port NATIVELY in TS: tau2 estimators tauSquaredHedges(yi,vi), tauSquaredSidikJonkman(yi,vi),
tauSquaredPauleMandel(yi,vi) (iterative), each returning tau2 with documented formulas, reusing
lib/stats/distributions. Pure math, no LLM. tests: ORACLE — lock each estimator to hand-computed reference
values on a fixed yi/vi fixture (assert Paule-Mandel converges to the value solving its estimating equation).`,
  },
  {
    key: 'contextualRerank', label: 'assimilate:paper-qa',
    prompt: CTX + `

ASSIMILATE paper-qa (backend/engines/paper-qa) — port its RCS (relevance-scored contextual summarization)
reranking natively to strengthen retrieval. Own ONLY: lib/retrieval/contextualRerank.ts,
tests/contextualRerank.test.ts.
Read backend/engines/paper-qa (each retrieved chunk gets a query-conditioned relevance score + a contextual
summary before it may enter an answer; refuse when none clear a threshold). Port NATIVELY: contextualRerank(
query, sources[{id,raw_text}], deps?) -> for each source Claude produces { relevanceScore 0-10, contextSummary
} (callClaudeForJson+Zod), then native TS filters below a documented threshold and re-ranks by score,
returning the ordered, summarized, above-threshold sources (honest empty when none qualify). Injectable Claude
for offline tests. tests: assert threshold filtering + re-ordering over mocked scores.`,
  },
  {
    key: 'entailment', label: 'assimilate:minicheck',
    prompt: CTX + `

ASSIMILATE MiniCheck (backend/engines/MiniCheck) — port its efficient claim-vs-document ENTAILMENT check
natively (complements lib/grounding verbatim spans with support judgement). Own ONLY: lib/grounding/entailment.ts,
tests/entailment.test.ts.
Read backend/engines/MiniCheck (predicts whether each claim/sentence is SUPPORTED by a document, sentence-
level). Port NATIVELY: checkEntailment({ claim, document }, deps?) -> Claude judges supported (bool) + the
supporting sentence, then GROUND the supporting sentence to the document via lib/grounding (a support claim
whose sentence isn't in the document is downgraded to unsupported). Return { supported, score, supportingSpan }.
Injectable Claude for offline tests. tests: assert the grounding-downgrade (fabricated support sentence ->
unsupported) + supported case over mocks.`,
  },
  {
    key: 'outlineWrite', label: 'assimilate:storm',
    prompt: CTX + `

ASSIMILATE STORM (backend/engines/storm) — port its OUTLINE-THEN-WRITE, multi-perspective synthesis natively
(complements lib/synthesisReport; do NOT edit it). Own ONLY: lib/synthesis/outline.ts, tests/outline.test.ts.
Read backend/engines/storm (knowledge_storm: perspective-guided question generation -> outline -> section-by-
section grounded writing). Port NATIVELY: outlineThenWrite({ topic, sources }, deps?) -> Claude generates a
multi-perspective section outline (callClaudeForJson+Zod), then writes each section grounded ONLY in the
provided sources (every claim grounds to a source span via lib/grounding; ungrounded sentences dropped),
returning { outline, sections:[{heading, content, citations}] }. Injectable Claude for offline tests. tests:
assert outline->per-section grounded writing + ungrounded-drop over mocks.`,
  },
  {
    key: 'valsci', label: 'assimilate:valsci',
    prompt: CTX + `

ASSIMILATE Valsci (backend/engines/Valsci) — port its scientific-claim SCORING natively (complements
lib/scieval). Own ONLY: lib/scieval/valsci.ts, tests/valsci.test.ts.
Read backend/engines/Valsci (its claim-processing: gather papers, per-paper relevance + support scoring,
aggregate to a claim-level score + rationale). Port NATIVELY: scoreClaim({ claim, sources }, deps?) -> for
each source Claude scores relevance + support(-1..1) with a quoted span (callClaudeForJson+Zod); native TS
aggregates a claim-level score (documented weighting by relevance) + classifies supported|mixed|refuted|
insufficient; GROUND each quoted span (drop ungroundable). Injectable Claude for offline tests. tests: assert
the deterministic aggregation + grounding drop over mocked per-source scores.`,
  },
]

phase('Port')
log('Assimilating 7 more OSS into native PaperTrail TS features…')
const built = await pipeline(
  VERTICALS,
  (v) => agent(v.prompt, { label: v.label, phase: 'Port', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, v) => {
    if (!build) return { feature: v.key, build: null, verdict: null }
    return agent(
      CTX + '\n\nADVERSARIALLY VERIFY the "' + v.key + '" assimilation. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm faithfulPort (native TS implements the REAL algorithm from backend/engines/), nativeNoPython (NO
python/subprocess/HTTP/vendor — pure TS + Claude only for the ML step), tested (deterministic math/flow +
grounding covered; run the test). Problems -> issues 'blocker'; default booleans false if unconfirmed.`,
      { label: 'verify:' + v.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ feature: v.key, build, verdict }))
  }
)
const results = built.filter(Boolean)
const solid = results.filter((r) => r.verdict?.nativeNoPython && r.verdict?.tested)
log('Assimilated ' + solid.length + '/' + results.length + ' more OSS natively.')

phase('Report')
return {
  features: results.map((r) => ({
    feature: r.feature, source: r.build?.sourceOss || '', files: r.build?.filesWritten || [],
    nativeNoPython: r.verdict?.nativeNoPython ?? null, tested: r.verdict?.tested ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  solid: solid.length, total: results.length,
}

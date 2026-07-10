export const meta = {
  name: 'assimilate-oss',
  description: 'Turn the OSS projects INTO PaperTrail: port each one\'s real core algorithm from backend/engines/<name> into NATIVE TypeScript in lib/, running on OUR Postgres DB + OUR API routes + OUR console frontend. No Python, no HTTP adapter, no vendor — owned PaperTrail code. Each OSS becomes a native PaperTrail feature.',
  whenToUse: 'Assimilate the OSS codebases into PaperTrail\'s own stack as native features.',
  phases: [
    { title: 'Port', detail: 'per OSS: read backend/engines/<name>, port core to native TS on our stack + API + console' },
    { title: 'Verify', detail: 'adversarial: faithful native port? uses our DB/API? tsc + tests green?' },
    { title: 'Report', detail: 'assimilated features' },
  ],
}

const CTX = `PaperTrail — Next.js 16 (App Router, TS strict) + Postgres/pgvector + Anthropic Claude. We are
ASSIMILATING open-source projects (MIT/BSD/Apache — WE OWN THEM) into PaperTrail as NATIVE features. The OSS
source is in backend/engines/<name> (read it to port the REAL algorithm faithfully). HARD RULES:
- NO Python. NO subprocess. NO HTTP call to a separate service. NO vendoring. PORT the algorithm into NATIVE
  TypeScript in lib/. If a step needs ML the OSS did with a trained model, use CLAUDE (lib/claude.ts:
  getClaude, CLAUDE_MODEL, callClaudeForJson + Zod) for that step — but keep the DETERMINISTIC parts native TS.
- USE OUR STACK: persistence via lib/db (getPool) + a db/migrations/NNNN_*.sql when state is needed;
  retrieval via lib/agents/retrievalAgent (retrieveSources over the cached 'sources' table) + lib/embeddings;
  grounding via lib/grounding (locateSpan); serve via app/api/<feature>/route.ts (nodejs, checkRateLimit,
  Zod, {success,data,error} envelope via lib/api/response, never log claim text); surface via
  app/console/<feature>/page.tsx ('use client', house Tailwind: bg-paper/text-ink/accent/border-ink/15, reuse
  components/console/StateBanners + the claims-page loading/error pattern).
- Deterministic math reuses lib/stats/distributions; pure/immutable; small files; explicit errors; org-scoped
  routes use withOrg+requireRole+writeAudit where they touch tenant data.
Each vertical owns ONLY its listed files (disjoint) so this runs safely alongside other in-flight work.`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['feature', 'sourceOss', 'filesWritten', 'nativeTs', 'usesOurStack', 'summary'],
  properties: {
    feature: { type: 'string' }, sourceOss: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    nativeTs: { type: 'boolean' }, usesOurStack: { type: 'boolean' }, summary: { type: 'string' },
    publicExports: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['feature', 'faithfulPort', 'nativeNoPython', 'usesOurDbApi', 'tested', 'issues'],
  properties: {
    feature: { type: 'string' }, faithfulPort: { type: 'boolean' }, nativeNoPython: { type: 'boolean' },
    usesOurDbApi: { type: 'boolean' }, tested: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const VERTICALS = [
  {
    key: 'activeLearning', label: 'assimilate:asreview',
    prompt: CTX + `

ASSIMILATE ASReview (backend/engines/asreview) — port its ACTIVE-LEARNING SCREENING core to native TS. Own
ONLY: lib/screening/activeLearning.ts, app/api/screening/active-learn/route.ts, tests/activeLearning.test.ts.
Read backend/engines/asreview (the feature_extractors=Tfidf, classifiers=NaiveBayes, queriers=Max cycle).
Port NATIVELY: a TF-IDF vectorizer + a Naive-Bayes (or logistic) classifier + a Max/uncertainty query
strategy, all pure TS math. rankRecordsAL(records[{id,title,abstract}], labeled[{id,label01}]) -> fit on
labeled, score unlabeled, return ranked most-relevant-first. This is the REAL ASReview loop in TS — no
Claude needed for the math. Wire an ORG-scoped route (screening is tenant data; withOrg + requireRole) that
loads a project's sr_records via getPool and ranks pending ones. tests: assert TF-IDF + NB produce a
sensible ranking on a fixed toy corpus (a labeled-relevant term ranks its unlabeled matches first).`,
  },
  {
    key: 'factCheck', label: 'assimilate:loki',
    prompt: CTX + `

ASSIMILATE Loki / OpenFactVerification (backend/engines/OpenFactVerification) — port its MULTI-STEP FACT
VERIFICATION pipeline to native TS. Own ONLY: lib/factcheck/pipeline.ts, lib/factcheck/schemas.ts,
app/api/factcheck/route.ts, app/console/factcheck/page.tsx, app/console/factcheck/_components/types.ts,
tests/factcheck.test.ts.
Read backend/engines/OpenFactVerification (the decompose -> checkworthy -> query-generation -> retrieve ->
verify solver chain). Port NATIVELY: Claude decomposes text into atomic claims + checkworthiness
(callClaudeForJson+Zod); for each checkworthy claim, retrieve evidence via lib/agents/retrievalAgent over OUR
sources; Claude judges supported|refuted|unverified grounded to a retrieved span (lib/grounding); aggregate
an overall factuality. Public route + console page (claim in -> per-claim verdicts with grounded evidence).
tests: over mocked retrieval+Claude assert the decompose->per-claim-verdict->aggregate flow + grounding drop.`,
  },
  {
    key: 'kgAlgos', label: 'assimilate:biocypher-pykeen',
    prompt: CTX + `

ASSIMILATE BioCypher + PyKEEN into our knowledge graph (lib/kg already has graph.ts/repository.ts — do NOT
edit them; ADD new files). Own ONLY: lib/kg/biolink.ts, lib/kg/linkPredict.ts, app/api/kg/predict/route.ts,
tests/kgAlgos.test.ts.
- biolink.ts (from backend/engines/biocypher): port the Biolink-model TYPING — map our entity_type/predicate
  strings to canonical Biolink categories/predicates (a documented static mapping ported from BioCypher's
  ontology schema). Pure TS.
- linkPredict.ts (from backend/engines/pykeen): port a NATIVE graph link-prediction — since we won't train
  torch embeddings, implement the standard topology scorers (common-neighbors, Adamic-Adar, resource-
  allocation, preferential-attachment) over OUR kg_edges (read neighbors via lib/kg/repository, import it),
  ranking candidate (subject, predicate, object) links = novel repurposing/association hypotheses. Pure TS math.
- app/api/kg/predict/route.ts: public POST { from?, predicate? } -> ranked predicted links with scores.
tests: assert Adamic-Adar/RA scores on a fixed small graph match hand-computed values, and Biolink typing maps.`,
  },
  {
    key: 'mechanism', label: 'assimilate:indra',
    prompt: CTX + `

ASSIMILATE INDRA (backend/engines/indra) — port its MECHANISM-STATEMENT ASSEMBLY (causal statements with a
belief score + provenance) to native TS. Own ONLY: lib/mechanism/assemble.ts, lib/mechanism/schemas.ts,
app/api/mechanism/route.ts, app/console/mechanism/page.tsx, app/console/mechanism/_components/types.ts,
tests/mechanism.test.ts.
Read backend/engines/indra (Statement types Activation/Inhibition/Phosphorylation/Complex; the belief model
= combine evidence). Port NATIVELY: Claude extracts causal mechanistic statements { subj, relation
(activates|inhibits|phosphorylates|binds|regulates), obj, evidenceQuote } from source text
(callClaudeForJson+Zod), GROUND each evidence quote to the source via lib/grounding (drop ungroundable), and
compute a DETERMINISTIC belief score from evidence count + source tier (port INDRA's belief-combination idea:
belief = 1 - prod(1 - source_reliability) — documented). Persist statements as edges in OUR kg (import
lib/kg/repository upsertEdge with provenance). Public route + console (text -> mechanistic statements with
belief + grounded evidence). tests: assert the deterministic belief combination + grounding drop over mocks.`,
  },
  {
    key: 'sciVerify', label: 'assimilate:multivers',
    prompt: CTX + `

ASSIMILATE MultiVerS + SciFact (backend/engines/multivers) — port SCIENTIFIC CLAIM VERIFICATION (label +
rationale) to native TS. Own ONLY: lib/scieval/verify.ts, lib/scieval/schemas.ts, app/api/scieval/route.ts,
tests/scieval.test.ts.
Read backend/engines/multivers (SUPPORTS/REFUTES/NEI label + rationale-sentence selection over an abstract).
Port NATIVELY: given { claim, abstract } (or retrieve the abstract from OUR sources), Claude assigns
SUPPORTS|REFUTES|NEI AND selects the rationale sentences (callClaudeForJson+Zod); GROUND each rationale
sentence to the abstract via lib/grounding (a rationale that isn't a verbatim sentence is dropped); NEI when
no grounded rationale supports the label. Public route. tests: over mocked Claude+grounding assert the
label+rationale flow and that a fabricated rationale sentence is dropped (NEI).`,
  },
  {
    key: 'deepResearch2', label: 'assimilate:gpt-researcher',
    prompt: CTX + `

ASSIMILATE gpt-researcher + open_deep_research (backend/engines/gpt-researcher, backend/engines/open_deep_
research) — port their PARALLEL DEEP-RESEARCH orchestration patterns as a native TS engine (complements the
existing lib/deepResearch — do NOT edit it; new namespace). Own ONLY: lib/research/orchestrator.ts,
lib/research/schemas.ts, app/api/research/route.ts, tests/research.test.ts.
Read the two repos (their planner -> parallel sub-query executor -> per-source compression -> report writer,
and the role-specialized model idea). Port NATIVELY: Claude plans sub-questions; for each, retrieve over OUR
sources (retrieveSources) IN PARALLEL; Claude COMPRESSES each source to claim-relevant evidence; Claude
writes a cited report where every claim grounds to a compressed source span (lib/grounding). Make
retrieval/Claude injectable for offline tests. Public route { question } -> plan + per-subq evidence + cited
report. tests: over mocks assert the parallel plan->compress->report flow and grounding.`,
  },
  {
    key: 'hybridRag', label: 'assimilate:r2r',
    prompt: CTX + `

ASSIMILATE R2R (backend/engines/R2R) — port its HYBRID RETRIEVAL (vector + full-text + graph) as a native TS
retriever over OUR sources. Own ONLY: lib/retrieval/hybrid.ts, app/api/retrieval/hybrid/route.ts,
tests/hybridRetrieval.test.ts.
Read backend/engines/R2R (hybrid search: combine semantic (pgvector) + keyword (full-text) with Reciprocal
Rank Fusion, plus graph-expansion). Port NATIVELY over OUR Postgres 'sources' table: hybridSearch(query,
deps?) runs a pgvector similarity query (reuse lib/embeddings + the existing retrieval SQL pattern) AND a
Postgres full-text/ILIKE keyword query, then fuses the two rankings with Reciprocal Rank Fusion (documented
k constant), optionally expanding via kg neighbors. Pure fusion math is deterministic. Injectable pool/embed
for offline tests. Public route. tests: assert RRF fusion of two mocked ranked lists matches hand-computed
scores + ordering.`,
  },
]

phase('Port')
log('Assimilating 7 OSS projects into native PaperTrail TS features on our stack…')
const built = await pipeline(
  VERTICALS,
  (v) => agent(v.prompt, { label: v.label, phase: 'Port', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, v) => {
    if (!build) return { feature: v.key, build: null, verdict: null }
    return agent(
      CTX + '\n\nADVERSARIALLY VERIFY the "' + v.key + '" assimilation. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm: faithfulPort (the native TS implements the REAL algorithm from backend/engines/` + (build.sourceOss || v.key) + `,
not a hand-wave), nativeNoPython (NO python/subprocess/HTTP-to-service/vendor — pure TS, Claude only for the
ML-reasoning step), usesOurDbApi (persists via lib/db/migrations, retrieves via our retrievalAgent/sources,
serves via app/api + app/console, grounds via lib/grounding), tested (the deterministic math / flow is covered;
run the test). Put real problems in issues as 'blocker'; default booleans false if unconfirmed.`,
      { label: 'verify:' + v.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ feature: v.key, build, verdict }))
  }
)
const results = built.filter(Boolean)
const solid = results.filter((r) => r.verdict?.nativeNoPython && r.verdict?.usesOurDbApi && r.verdict?.tested)
log('Assimilated ' + solid.length + '/' + results.length + ' OSS into native PaperTrail features.')

phase('Report')
return {
  features: results.map((r) => ({
    feature: r.feature, source: r.build?.sourceOss || '', files: r.build?.filesWritten || [],
    nativeNoPython: r.verdict?.nativeNoPython ?? null, usesOurDbApi: r.verdict?.usesOurDbApi ?? null,
    tested: r.verdict?.tested ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  solid: solid.length, total: results.length,
}

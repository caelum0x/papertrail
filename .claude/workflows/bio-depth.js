export const meta = {
  name: 'bio-depth',
  description: 'Extend PaperTrail\'s deterministic moat DEEPER into biology — pharmacovigilance signal detection (FAERS PRR/ROR/IC), genetic association verification (GWAS Catalog + ClinVar), target-disease evidence (Open Targets), and biomedical entity normalization (PubTator). Backend-first: engines + APIs + oracle tests, minimal/no UI.',
  whenToUse: 'To add molecular/genomic/pharmacological depth wired to canonical open bio-data sources, keeping numbers deterministic (no LLM in the numeric loop).',
  phases: [
    { title: 'Build', detail: 'parallel disjoint bio engines: pharmacovigilance, genetics, targets, entity-normalization' },
    { title: 'Verify', detail: 'adversarial: real APIs? deterministic numbers? oracle tests?' },
    { title: 'Report', detail: 'engines + how each is wired' },
  ],
}

const CTX = `PaperTrail — Next.js 14+/TS/Postgres+pgvector, Anthropic Claude. MOAT = DETERMINISTIC
biostatistics on real medical data, NO LLM IN THE NUMERIC LOOP. This adds BIOLOGY depth as
BACKEND capabilities (engines + APIs + oracle tests) — minimal/NO frontend.

Conventions: pure/immutable, oracle-tested numeric functions; reuse lib/stats/distributions
(normalQuantile, ciZ, studentTCdf, chiSquareSurvival, incompleteBeta) — never reimplement. Public
compute routes mirror app/api/verify/route.ts (nodejs runtime, rate-limited via lib/rateLimit,
{success,data,error} envelope via lib/api/response ok/fail, Zod-validate the body, never log claim
text). Network calls to external bio APIs go through a small injectable fetcher so tests run offline
(mock the fetch) — mirror lib/ingest/searchAndCache.ts's injectable-deps pattern. Cache/normalize
responses; handle API failure gracefully (honest empty result, never a fabricated number).

Existing: lib/biostats.ts (riskRatioFromCounts — 2x2 patterns to mirror), lib/effectSize.ts,
lib/stats/distributions.ts. New code lives under lib/bio/* + app/api/bio/*.`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'filesWritten', 'dataSource', 'deterministic', 'summary'],
  properties: {
    engine: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    dataSource: { type: 'string', description: 'the real bio API/source used' },
    deterministic: { type: 'boolean', description: 'true if the numbers are computed deterministically (no LLM)' },
    summary: { type: 'string' }, publicExports: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'realDataSource', 'numbersDeterministic', 'oracleTested', 'issues'],
  properties: {
    engine: { type: 'string' },
    realDataSource: { type: 'boolean' }, numbersDeterministic: { type: 'boolean' }, oracleTested: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const ENGINES = [
  {
    key: 'pharmacovigilance', label: 'bio:pharmacovigilance',
    prompt: CTX + `

BUILD DETERMINISTIC PHARMACOVIGILANCE SIGNAL DETECTION on FDA FAERS (openFDA). Own ONLY:
lib/bio/pharmacovigilance.ts, app/api/bio/safety-signal/route.ts, tests/pharmacovigilance.test.ts.
lib/bio/pharmacovigilance.ts (pure numeric core + an injectable fetcher):
- disproportionality({ a, b, c, d }) from the drug-event 2x2 (a = reports of THIS drug + THIS event;
  b = this drug + other events; c = other drugs + this event; d = other drugs + other events) ->
  { prr, prrCiLower, prrCiUpper, ror, rorCiLower, rorCiUpper, chiSquared, chiSquaredYates, pValue,
    informationComponent (IC = log2( a*(a+b+c+d) / ((a+b)*(a+c)) )), ic025 (lower 95% credibility),
    signal (bool: PRR>=2 AND a>=3 AND chiSquaredYates>=4, the classic EBGM/MHRA criterion) }.
  Use lib/stats/distributions for the CI z and chi-square p. Document every formula. Oracle-testable.
- fetchFaersCounts(drug, event, deps?) -> queries openFDA /drug/event.json count endpoints to assemble
  the 2x2 (inject the fetcher; default hits https://api.fda.gov). Returns null on failure.
- assessSafetySignal(drug, event, deps?) -> combines fetch + disproportionality.
app/api/bio/safety-signal/route.ts: public POST { drug, event }, nodejs, rate-limited, Zod, envelope.
tests: ORACLE test locking PRR/ROR/chi2/IC to hand-computed reference values for a fixed 2x2 (e.g.
a=25,b=1000,c=200,d=50000), plus the signal-criterion boolean and a zero-cell guard. Mock any fetch.`,
  },
  {
    key: 'genetics', label: 'bio:genetic-association',
    prompt: CTX + `

BUILD GENETIC ASSOCIATION VERIFICATION against the GWAS Catalog + ClinVar. Own ONLY:
lib/bio/geneticAssociation.ts, lib/bio/genetics.schemas.ts, app/api/bio/genetic-association/route.ts,
tests/geneticAssociation.test.ts.
lib/bio/geneticAssociation.ts (injectable fetchers so tests are offline):
- queryGwasCatalog(trait|gene|variant, deps?) -> associations [{ rsId, gene, trait, pValue, orBeta,
  riskAllele, study }] from the EBI GWAS Catalog REST API (https://www.ebi.ac.uk/gwas/rest/api).
- queryClinVar(gene|variant, deps?) -> [{ variant, clinicalSignificance, condition, reviewStatus }]
  via NCBI E-utilities (esearch+esummary on clinvar).
- verifyGeneticAssociation({ gene?, variant?, disease }, deps?) -> a DETERMINISTIC verdict:
  genome_wide_significant (any association with pValue <= 5e-8 for the disease) | suggestive
  (5e-8 < p <= 1e-5) | reported_not_significant | clinvar_pathogenic | conflicting | no_association_found,
  with the supporting records (never fabricated — only what the APIs returned). The significance
  thresholds are the field-standard constants, documented.
app/api/bio/genetic-association/route.ts: public POST { gene?, variant?, disease }, rate-limited, Zod, envelope.
tests: verdict logic over MOCKED API responses (a p=3e-9 hit -> genome_wide_significant; a p=1e-6 ->
suggestive; empty -> no_association_found; a ClinVar Pathogenic -> clinvar_pathogenic). No live network.`,
  },
  {
    key: 'targets', label: 'bio:target-disease',
    prompt: CTX + `

BUILD TARGET-DISEASE EVIDENCE aggregation via the Open Targets Platform GraphQL API. Own ONLY:
lib/bio/openTargets.ts, lib/bio/targets.schemas.ts, app/api/bio/target-disease/route.ts,
tests/openTargets.test.ts.
lib/bio/openTargets.ts (injectable fetcher):
- resolveTarget(symbol, deps?) / resolveDisease(name, deps?) -> Ensembl gene id / EFO id via Open
  Targets search.
- targetDiseaseEvidence(targetSymbol, diseaseName, deps?) -> query Open Targets GraphQL
  (https://api.platform.opentargets.org/api/v4/graphql) for the association: overall + per-datatype
  scores (genetic_association, known_drug, literature, animal_model), plus known drugs and tractability.
  Return the DETERMINISTIC scores from the API verbatim (no LLM math). Provide an OPTIONAL
  summarizeEvidence(evidence) that calls Claude (callClaudeForJson + Zod) to write a plain-language
  summary — but the SCORES stay from the API, and the summary must only reference returned data.
app/api/bio/target-disease/route.ts: public POST { target, disease }, rate-limited, Zod, envelope.
tests: over a MOCKED GraphQL response, assert the scores are parsed/returned faithfully and the
no-association case is honest. No live network in the test.`,
  },
  {
    key: 'pubtator', label: 'bio:entity-normalization',
    prompt: CTX + `

BUILD BIOMEDICAL ENTITY NORMALIZATION via NCBI PubTator Central — the grounding layer that maps free
text / PMIDs to normalized bio-entities. Own ONLY: lib/bio/pubtator.ts, lib/bio/entities.schemas.ts,
app/api/bio/annotate/route.ts, tests/pubtator.test.ts.
lib/bio/pubtator.ts (injectable fetcher):
- annotatePmids(pmids, deps?) -> for each PMID, PubTator Central annotations
  (https://www.ncbi.nlm.nih.gov/research/pubtator3-api/) as entities [{ text, type: gene|disease|
  chemical|variant|species, normalizedId (e.g. NCBI Gene:673, MESH:D009369, dbSNP:rs...), offsets }].
- annotateText(text, deps?) -> PubTator's on-the-fly annotation for arbitrary text (submit + retrieve),
  same normalized entity shape.
- A pure normalizeEntities() helper that de-dupes + groups the raw annotations by type + normalizedId.
Never fabricate an entity; only return what PubTator resolved. app/api/bio/annotate/route.ts: public
POST { pmids? , text? }, rate-limited, Zod, envelope, sanitize free text, never log it.
tests: over MOCKED PubTator responses, assert entities are parsed + normalized + de-duped correctly,
and empty/failed responses yield an honest empty result. No live network.`,
  },
]

// PHASE 1 — BUILD -> VERIFY (pipelined, disjoint under lib/bio + app/api/bio)
phase('Build')
log('Building 4 biology backend engines wired to real bio-data sources…')
const built = await pipeline(
  ENGINES,
  (e) => agent(e.prompt, { label: e.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, e) => {
    if (!build) return { engine: e.key, build: null, verdict: null }
    return agent(
      CTX + '\n\nADVERSARIALLY VERIFY the "' + e.key + '" bio engine. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm: (1) realDataSource — it calls the ACTUAL bio API (openFDA / GWAS Catalog + ClinVar / Open Targets
GraphQL / PubTator), with the correct endpoint + response parsing, not a stub. (2) numbersDeterministic —
every statistic (PRR/ROR/chi2/IC, significance thresholds, association scores) is computed/derived
deterministically, NOT from an LLM; any Claude use is summary-only over returned data. (3) oracleTested —
recompute the pharmacovigilance stats by hand and check the oracle; verify the verdict/threshold logic for
genetics; confirm faithful parsing for targets/pubtator. Run the test. Put real problems in issues as
'blocker'. Default the booleans to false if you cannot confirm.`,
      { label: 'verify:' + e.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ engine: e.key, build, verdict }))
  }
)
const results = built.filter(Boolean)
const solid = results.filter((r) => r.verdict?.realDataSource && r.verdict?.numbersDeterministic)
log('Built ' + solid.length + '/' + results.length + ' bio engines on real data with deterministic numbers.')

// PHASE 2 — REPORT
phase('Report')
return {
  engines: results.map((r) => ({
    engine: r.engine, files: r.build?.filesWritten || [], dataSource: r.build?.dataSource || '',
    deterministic: r.build?.deterministic ?? null, realDataSource: r.verdict?.realDataSource ?? null,
    oracleTested: r.verdict?.oracleTested ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  solid: solid.length, total: results.length,
  wiringNext: [
    'safety-signal -> deepen the ae-signals / monitoring module with FAERS disproportionality',
    'genetic-association -> a new verification type for gene/variant-disease claims',
    'target-disease -> feed the knowledge graph + evidence report mechanistic context',
    'entity-normalization -> enrich cached sources + ground the knowledge graph in normalized bio-IDs',
  ],
}

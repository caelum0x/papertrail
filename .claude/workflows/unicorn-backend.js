export const meta = {
  name: 'unicorn-backend',
  description: 'Build the Evidence Intelligence platform backend that targets $200M+ pharma-AI comparables (Causaly, Aetion, Open Targets, DistillerSR): a provenance-bearing biomedical knowledge graph, an evidence-dossier orchestrator (target/drug/disease/claim -> complete verified cited trust-scored dossier), a regulatory hash-chained provenance + submission export layer, and deterministic real-world-evidence signals. Intense backend, open data, deterministic where load-bearing, Claude for orchestration/narrative only.',
  whenToUse: 'Turn PaperTrail into a provenance-grade evidence-intelligence platform for regulated pharma.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint: knowledge graph, dossier orchestrator, provenance/export, RWE signals' },
    { title: 'Verify', detail: 'adversarial: composes real engines? deterministic scoring? provenance sound? tested?' },
    { title: 'Integrate', detail: 'wire the dossier as a copilot tool + nav-free API + authoritative tsc/tests' },
    { title: 'Report', detail: 'platform pieces + wiring' },
  ],
}

const CTX = `PaperTrail is becoming an EVIDENCE INTELLIGENCE platform for regulated pharma (medical
affairs, regulatory, HEOR, R&D). Thesis (docs: memory unicorn-thesis): the buyer must PRODUCE and DEFEND
evidence for every claim/target/submission; the moat is provenance-grade, auditable evidence where Claude
assembles/reasons but DETERMINISTIC engines verify every number, on OPEN data (no proprietary EHR/wet-lab).
Next.js 16 / TS strict / Postgres+pgvector / Claude. Backend-intense, minimal/NO frontend.

COMPOSE these existing deterministic engines (READ; import; do NOT edit). Bio layer (all injectable deps
for offline tests, honest-empty on failure): lib/bio/verifyBiomedicalClaim.ts (verifyBiomedicalClaim),
lib/bio/geneticAssociation.ts, lib/bio/openTargets.ts (targetDiseaseEvidence), lib/bio/pharmacovigilance.ts
(assessSafetySignal, disproportionality), lib/bio/chembl.ts, lib/bio/variantPathogenicity.ts,
lib/bio/pharmgkb.ts, lib/bio/pubtator.ts (annotateText). Evidence layer: lib/evidencePipeline.ts
(runEvidencePipeline), lib/evidenceReport.ts (buildEvidenceReport), lib/grade.ts. Sources: lib/sources/*
(pubmed, clinicaltrials), lib/ingest/searchAndCache.ts. Stats: lib/stats/distributions.ts. Claude:
lib/claude.ts (getClaude, CLAUDE_MODEL, callClaudeForJson — validate every structured output with Zod).

RULES: public compute routes mirror app/api/bio/target-disease/route.ts (nodejs, checkRateLimit, Zod body,
ok/fail envelope, never log claim text). Deterministic scoring/verdicts with DOCUMENTED thresholds — NO LLM
in a load-bearing number. Claude only plans/narrates over already-verified data. Every external call behind
an injectable deps object so tests run OFFLINE against mocks. Pure/immutable; small files; explicit errors.`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'filesWritten', 'deterministic', 'composesRealEngines', 'summary'],
  properties: {
    vertical: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    deterministic: { type: 'boolean' }, composesRealEngines: { type: 'boolean' }, summary: { type: 'string' },
    publicExports: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['vertical', 'realEngines', 'deterministicNumbers', 'tested', 'issues'],
  properties: {
    vertical: { type: 'string' }, realEngines: { type: 'boolean' }, deterministicNumbers: { type: 'boolean' },
    tested: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const VERTICALS = [
  {
    key: 'kg', label: 'unicorn:knowledge-graph',
    prompt: CTX + `

BUILD the BIOMEDICAL EVIDENCE KNOWLEDGE GRAPH (Causaly's moat) — a persisted, provenance-bearing graph of
entities + typed relations across the open bio corpus, queryable for evidence paths. Own ONLY:
db/migrations/0052_knowledge-graph.sql, lib/kg/schemas.ts, lib/kg/repository.ts, lib/kg/graph.ts,
app/api/kg/route.ts, tests/kg.test.ts.
- 0052 migration: tables kg_nodes(id uuid pk default gen_random_uuid(), entity_type text, name text,
  normalized_id text, ... unique(entity_type, normalized_id)) and kg_edges(id uuid pk, subject_id uuid,
  predicate text, object_id uuid, provenance jsonb (source + evidence ref + grounded quote + score),
  created_at). Indexes on (subject_id), (object_id), (predicate). READ db/migrations/0001_foundation.sql
  for house style. NOT org-scoped (public reference facts).
- lib/kg/repository.ts: pure data access (upsertNode, upsertEdge, neighbors(nodeId), findPaths(fromId,
  toId, maxHops) via recursive edge walk). Parameterized SQL only.
- lib/kg/graph.ts: ingestClaimGraph({ text | source }, deps?) — use lib/bio/pubtator annotateText to get
  normalized entities, and the bio relation engines (geneticAssociation, targetDiseaseEvidence) to derive
  typed edges (gene-associates_with->disease, drug-targets->gene, etc.), EACH edge carrying provenance
  (source + grounded evidence + a deterministic confidence). Persist via the repository. queryPath(from,
  to) returns provenance-annotated evidence paths. Injectable deps for offline tests.
- app/api/kg/route.ts: public POST { ingest:{text} } | { path:{from,to} }, rate-limited, Zod, envelope.
tests: over MOCKED bio deps + an in-memory/mock pool, assert entity+edge ingestion with provenance and a
2-hop path query returns the provenance-annotated path. Deterministic.`,
  },
  {
    key: 'dossier', label: 'unicorn:evidence-dossier',
    prompt: CTX + `

BUILD the EVIDENCE DOSSIER ORCHESTRATOR — the flagship. Given a subject (target gene / drug / disease /
claim), autonomously assemble a COMPLETE, verified, cited, TRUST-SCORED evidence dossier. Own ONLY:
lib/dossier/schemas.ts, lib/dossier/build.ts, app/api/dossier/route.ts, tests/dossier.test.ts.
lib/dossier/build.ts: buildEvidenceDossier({ subjectType: 'target'|'drug'|'disease'|'claim', subject,
disease? }, deps?):
1. Claude PLANS the relevant evidence sections for the subject type (callClaudeForJson + Zod) — e.g. a
   target dossier -> [genetic validation, tractability, existing drugs/trials, safety liabilities,
   mechanism]. Claude only chooses WHICH deterministic checks to run.
2. Run the applicable EXISTING engines (injected) to fill each section with VERIFIED data:
   genetic (verifyGeneticAssociation / targetDiseaseEvidence), tractability+drugs (chembl), trials
   (searchAndCache/clinicaltrials + runEvidencePipeline for an efficacy claim), safety (assessSafetySignal),
   mechanism (pubtator + kg not required). Each section carries its engine verdict + citations.
3. Compute a DETERMINISTIC overall dossier confidence 0-1 from the section signals (documented weighting:
   e.g. genome-wide genetic + known drug + no safety flag -> high) and an overall grade
   (strong|moderate|emerging|weak|contradicted). NO LLM decides the score.
4. Claude writes an executive-summary NARRATIVE over ONLY the verified sections (callClaudeForJson + Zod);
   the narrative may not introduce a number or citation not already in a section.
Return { subject, sections:[{name, verdict, score, citations, detail}], overallScore, overallGrade,
narrative }. app/api/dossier/route.ts: public POST, rate-limited, sanitize, Zod, envelope, never log subject.
tests: over MOCKED engine deps + a mock Claude planner/narrator, assert section routing by subjectType, the
deterministic overall-score/grade rules, and that the narrative path is isolated (a Claude failure still
returns the verified sections + score).`,
  },
  {
    key: 'provenance', label: 'unicorn:provenance-export',
    prompt: CTX + `

BUILD the REGULATORY PROVENANCE + SUBMISSION-EXPORT layer — the moat for regulated buyers: every number is
hash-chained to its source, and the dossier exports as a submission-grade artifact. Own ONLY:
lib/provenance/chain.ts, lib/provenance/export.ts, app/api/dossier/export/route.ts, tests/provenance.test.ts.
- lib/provenance/chain.ts: define a local EvidenceItem type { statement, value, source, quote }. build
  ProvenanceChain(items) -> ordered records each with sha256(prevHash + canonical(item)) so the chain is
  tamper-evident (like a mini hash-chained audit log; reuse node:crypto). verifyChain(chain) -> boolean.
  Pure, deterministic. A deterministic evidenceQualityScore(items) (coverage + source-tier weighting,
  documented) 0-1.
- lib/provenance/export.ts: dossierToStructured(dossier) -> a stable, submission-grade JSON (sections,
  each claim with its provenance hash + source), and dossierToText(dossier) -> a plain-text dossier
  (reuse the shape used by lib/evidenceReportExport if helpful). Accept a generic dossier-like input
  (define the minimal shape locally so you do NOT depend on the parallel dossier vertical's exact types).
- app/api/dossier/export/route.ts: public POST { dossier } (a computed dossier bundle) -> returns the
  structured + hash-chained provenance (?format=text for the text variant), rate-limited, Zod, envelope.
tests: assert the hash chain is order-sensitive + tamper-evident (mutating one item breaks verifyChain), the
quality score logic, and a round-trip export contains every claim's provenance hash.`,
  },
  {
    key: 'rwe', label: 'unicorn:rwe-signals',
    prompt: CTX + `

BUILD DETERMINISTIC REAL-WORLD-EVIDENCE SIGNALS (the Aetion angle) — temporal evidence trends from the open
corpus, no proprietary EHR. Own ONLY: lib/rwe/schemas.ts, lib/rwe/signals.ts, app/api/rwe/route.ts,
tests/rwe.test.ts.
lib/rwe/signals.ts (injectable fetchers; deterministic math via lib/stats/distributions):
- adverseEventTrend({ drug, event }, deps?) -> per-year FAERS report counts + per-year disproportionality
  (reuse lib/bio/pharmacovigilance disproportionality) -> a trend { years:[{year, prr, ic, reports}],
  direction: rising|stable|falling } via a deterministic slope over the yearly IC.
- evidenceVolumeTrend({ topic }, deps?) -> per-year PubMed hit counts (E-utilities) + ClinicalTrials.gov
  trial starts per year -> { publications:[{year,count}], trials:[{year,count}], maturity:
  emerging|active|established } by deterministic thresholds.
- Combine into rweProfile({ drug?, topic?, event? }, deps?) returning the available signals + a documented
  deterministic summary. Honest-empty on failure; NO LLM in the numbers.
app/api/rwe/route.ts: public POST { drug?, topic?, event? }, rate-limited, Zod, envelope.
tests: over MOCKED yearly counts assert the disproportionality-by-year, the slope/direction classification
(rising when yearly IC trends up), and the maturity thresholds. Deterministic.`,
  },
]

// PHASE 1 — BUILD -> VERIFY (pipelined, disjoint namespaces)
phase('Build')
log('Building the Evidence Intelligence platform: knowledge graph, dossier orchestrator, provenance/export, RWE signals…')
const built = await pipeline(
  VERTICALS,
  (v) => agent(v.prompt, { label: v.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, v) => {
    if (!build) return { vertical: v.key, build: null, verdict: null }
    return agent(
      CTX + '\n\nADVERSARIALLY VERIFY the "' + v.key + '" vertical. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm: realEngines (composes/persists via the ACTUAL existing engines + SQL, not stubs; correct endpoints),
deterministicNumbers (scores/verdicts/hashes/trends are computed deterministically with documented thresholds;
Claude is planning/narrative only and never a load-bearing number), tested (routing/score/hash/trend logic
covered over mocked deps + mock pool; run the test). Put real problems in issues as 'blocker'; default the
booleans to false if unconfirmed.`,
      { label: 'verify:' + v.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ vertical: v.key, build, verdict }))
  }
)
const results = built.filter(Boolean)
const solid = results.filter((r) => r.verdict?.realEngines && r.verdict?.deterministicNumbers && r.verdict?.tested)
log('Built ' + solid.length + '/' + results.length + ' platform verticals (real engines, deterministic, tested).')

// PHASE 2 — INTEGRATE (dossier as a copilot tool; authoritative build) — after builds, single agent
phase('Integrate')
const integration = await agent(
  CTX + `

INTEGRATE this round and keep the app green.
1. Add the evidence dossier as a Research Copilot tool: in lib/copilot/tools.ts add a
   "build_evidence_dossier" tool that calls buildEvidenceDossier from lib/dossier/build.ts (import it),
   with a Zod input { subjectType, subject, disease? } + jsonSchema, and an executor returning the dossier
   as the tool output (citations from the sections). Register it in COPILOT_TOOLS. Keep the existing tools.
2. Run npx tsc --noEmit and fix type errors in this round's files; run npx vitest run and fix genuine
   breakage (fix wrong CODE, not correct tests). Do NOT weaken a deterministic test.
Report tsc pass/fail, vitest counts, and every file edited. Be honest about any residual red.`,
  { label: 'integrate:copilot+build', phase: 'Integrate', effort: 'high' }
)

phase('Report')
return {
  verticals: results.map((r) => ({
    vertical: r.vertical, files: r.build?.filesWritten || [], deterministic: r.build?.deterministic ?? null,
    realEngines: r.verdict?.realEngines ?? null, tested: r.verdict?.tested ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  integrationReport: integration,
  solid: solid.length, total: results.length,
}

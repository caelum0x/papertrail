export const meta = {
  name: 'bio-depth3',
  description: 'Bio capstone + Tier 3: a unified biomedical claim verifier that composes all 8 bio engines (entities→trial+genetic+safety+bioactivity+pathogenicity+PGx→one verdict), plus FAERS-derived drug-drug-interaction signals and biomarker validation evidence. Backend, deterministic, tested, no UI.',
  whenToUse: 'Tie the bio engines into a product-grade composite verifier and finish the open-data Tier-3 items.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint: composite biomedical verifier, DDI signals, biomarker validation' },
    { title: 'Verify', detail: 'adversarial: composes real engines? deterministic verdict? tested?' },
    { title: 'Report', detail: 'engines + wiring' },
  ],
}

const CTX = `PaperTrail — Next.js 16/TS/Postgres+pgvector, Claude. MOAT = DETERMINISTIC on real open
bio-data, NO LLM in the load-bearing numeric path. Backend only, no frontend.

The bio layer already built (READ; import, do NOT edit):
- lib/bio/pubtator.ts (annotateText -> normalized entities: gene/disease/chemical/variant)
- lib/bio/geneticAssociation.ts (verifyGeneticAssociation) + genetics.schemas.ts
- lib/bio/openTargets.ts (targetDiseaseEvidence)
- lib/bio/pharmacovigilance.ts (assessSafetySignal, disproportionality)
- lib/bio/chembl.ts (verifyBioactivityClaim, resolveMolecule, targetBioactivities)
- lib/bio/variantPathogenicity.ts (verifyPathogenicityClaim)
- lib/bio/pharmgkb.ts (verifyPgxClaim / lookupClinicalAnnotation)
Also lib/sources/clinicaltrials.ts + lib/effectSize.ts + lib/structuredVerification.ts for trials.

Conventions: pure/immutable; every external call behind an INJECTABLE deps object so tests run OFFLINE
against mocks (mirror lib/bio/openTargets.ts). Honest empty on failure, never a fabricated value. Public
routes mirror app/api/bio/target-disease/route.ts (nodejs, checkRateLimit, Zod, ok/fail envelope, never
log claim text). Deterministic verdicts with documented thresholds; Claude (if any) is summary-only.`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'filesWritten', 'deterministic', 'summary'],
  properties: {
    engine: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    deterministic: { type: 'boolean' }, summary: { type: 'string' },
    publicExports: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'composesRealEngines', 'deterministicVerdict', 'tested', 'issues'],
  properties: {
    engine: { type: 'string' }, composesRealEngines: { type: 'boolean' }, deterministicVerdict: { type: 'boolean' },
    tested: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const ENGINES = [
  {
    key: 'composite', label: 'bio:composite-verifier',
    prompt: CTX + `

BUILD the UNIFIED BIOMEDICAL CLAIM VERIFIER — the capstone that composes the bio engines into one
verdict. Own ONLY: lib/bio/verifyBiomedicalClaim.ts, lib/bio/biomedical.schemas.ts,
app/api/bio/verify-claim/route.ts, tests/verifyBiomedicalClaim.test.ts.
lib/bio/verifyBiomedicalClaim.ts: verifyBiomedicalClaim({ claim }, deps?) that:
1. Uses lib/bio/pubtator annotateText to extract the claim's entities (gene, disease, chemical/drug,
   variant) — this ROUTES which evidence checks apply.
2. Conditionally runs, in parallel, ONLY the relevant existing engines (all injected via deps so tests
   are offline): gene/variant+disease -> verifyGeneticAssociation + verifyPathogenicityClaim; drug+disease
   -> targetDiseaseEvidence + safety (assessSafetySignal); drug+target/potency -> verifyBioactivityClaim;
   gene/variant+drug -> verifyPgxClaim.
3. Returns a UNIFIED { claim, entities, checks: [{ kind, verdict, summary, source }], overallVerdict:
   supported | partially_supported | overstated | unsupported | insufficient_evidence, rationale }.
   overallVerdict is DETERMINISTIC from the component verdicts (documented rules: e.g. any 'overstated_*'
   or 'overstates_registry' present -> overstated; all positive -> supported; mixed -> partially_supported;
   none applicable/found -> insufficient_evidence). NO LLM decides the overall verdict.
app/api/bio/verify-claim/route.ts: public POST { claim }, rate-limited, sanitize, Zod, envelope, never log claim.
tests: over MOCKED engine deps, assert entity-driven routing (a gene-disease claim runs genetic+pathogenicity,
not bioactivity), the deterministic overall-verdict rules (an overstated component -> overstated overall;
all-positive -> supported), and honest insufficient_evidence when no entity resolves.`,
  },
  {
    key: 'ddi', label: 'bio:drug-drug-interaction',
    prompt: CTX + `

BUILD OPEN DRUG-DRUG-INTERACTION SIGNALS derived from FAERS (CC0) — deliberately AVOID DrugBank/DDInter
(paid/non-commercial). Own ONLY: lib/bio/ddi.ts, lib/bio/ddi.schemas.ts, app/api/bio/drug-interaction/route.ts,
tests/ddi.test.ts.
lib/bio/ddi.ts (injectable openFDA fetcher; reuse the disproportionality math from lib/bio/pharmacovigilance
by importing disproportionality): interactionSignal({ drugA, drugB, event }, deps?) that assembles, from
FAERS report counts, the 2x2 for "reports listing BOTH drugA AND drugB" vs the event, and computes the
disproportionality (PRR/ROR/chi2/IC) for the co-reported-drugs signal, PLUS an interaction contrast vs each
drug alone (is the combined signal materially higher than either single-drug signal -> possible synergy).
Return { drugA, drugB, event, combined: <disproportionality>, aAlone, bAlone, interaction:
synergistic_signal | no_excess | insufficient_data }. DETERMINISTIC; documented thresholds. Honest empty on failure.
app/api/bio/drug-interaction/route.ts: public POST { drugA, drugB, event }, rate-limited, Zod, envelope.
tests: over MOCKED FAERS counts assert the combined disproportionality, the synergy contrast logic (combined
IC materially > max(aAlone, bAlone) -> synergistic_signal), and insufficient_data on sparse counts.`,
  },
  {
    key: 'biomarker', label: 'bio:biomarker-validation',
    prompt: CTX + `

BUILD BIOMARKER VALIDATION EVIDENCE — assemble the evidence for a claimed biomarker<->disease (or
biomarker<->drug-response) relationship from existing engines. Own ONLY: lib/bio/biomarker.ts,
lib/bio/biomarker.schemas.ts, app/api/bio/biomarker/route.ts, tests/biomarker.test.ts.
lib/bio/biomarker.ts: validateBiomarker({ biomarker (gene/variant/protein), disease, drug? }, deps?) that
composes (injected): genetic evidence (verifyGeneticAssociation biomarker-disease), target-disease genetic
score (targetDiseaseEvidence when biomarker is a gene), literature grounding (pubtator annotateText co-mention
of biomarker+disease), and drug-response context (verifyPgxClaim when drug provided). Return { biomarker,
disease, evidence: {genetic, targetScore, literature, pharmacogenomic}, validationLevel:
analytically_grounded | emerging | weak | unsupported, rationale }. validationLevel is DETERMINISTIC from the
component strengths (documented). Honest empty on failure. Optional Claude summary over assembled evidence only.
app/api/bio/biomarker/route.ts: public POST { biomarker, disease, drug? }, rate-limited, Zod, envelope.
tests: over MOCKED component evidence assert the validationLevel rules (genome-wide genetic + literature ->
analytically_grounded; only weak literature -> weak; nothing -> unsupported).`,
  },
]

phase('Build')
log('Bio capstone: composite verifier + FAERS-DDI + biomarker validation…')
const built = await pipeline(
  ENGINES,
  (e) => agent(e.prompt, { label: e.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, e) => {
    if (!build) return { engine: e.key, build: null, verdict: null }
    return agent(
      CTX + '\n\nADVERSARIALLY VERIFY the "' + e.key + '" engine. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm: composesRealEngines (imports + calls the ACTUAL lib/bio engines, injected; does NOT reimplement or
stub them), deterministicVerdict (the overall verdict/level/signal is decided by documented rules over
component outputs, NOT by an LLM), tested (routing + verdict rules covered over mocked deps; run the test).
Put real problems in issues as 'blocker'; default booleans to false if unconfirmed.`,
      { label: 'verify:' + e.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ engine: e.key, build, verdict }))
  }
)
const results = built.filter(Boolean)
const solid = results.filter((r) => r.verdict?.composesRealEngines && r.verdict?.deterministicVerdict && r.verdict?.tested)
log('Built ' + solid.length + '/' + results.length + ' capstone/Tier-3 bio engines.')

phase('Report')
return {
  engines: results.map((r) => ({
    engine: r.engine, files: r.build?.filesWritten || [], deterministic: r.build?.deterministic ?? null,
    composesRealEngines: r.verdict?.composesRealEngines ?? null, tested: r.verdict?.tested ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  solid: solid.length, total: results.length,
}

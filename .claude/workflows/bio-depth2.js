export const meta = {
  name: 'bio-depth2',
  description: 'Tier-2 biology backend: ChEMBL drug-target bioactivity verification, ClinVar variant pathogenicity, drug-repurposing evidence bundles, and PharmGKB pharmacogenomic annotation. Backend-first, deterministic on open bio-data, oracle-tested, no UI.',
  whenToUse: 'Extend PaperTrail bio-depth per docs/bio-roadmap.md Tier 2 — the commercially-validated open-data capabilities pharma R&D/translational teams pay for.',
  phases: [
    { title: 'Build', detail: 'parallel disjoint: ChEMBL bioactivity, variant pathogenicity, repurposing evidence, pharmacogenomics' },
    { title: 'Verify', detail: 'adversarial: real API? deterministic? oracle/logic tested?' },
    { title: 'Report', detail: 'engines + wiring' },
  ],
}

const CTX = `PaperTrail — Next.js 16/TS/Postgres+pgvector, Anthropic Claude. MOAT = DETERMINISTIC
biostatistics/lookups on real open bio-data, NO LLM IN THE LOAD-BEARING NUMERIC PATH. This adds
Tier-2 biology BACKEND capabilities (engines + APIs + tests) — minimal/NO frontend.

Existing bio layer to match exactly (READ them for the pattern): lib/bio/openTargets.ts,
lib/bio/pharmacovigilance.ts, lib/bio/geneticAssociation.ts, lib/bio/pubtator.ts, and their routes
app/api/bio/target-disease|safety-signal|genetic-association|annotate/route.ts. Conventions:
- Pure/immutable; reuse lib/stats/distributions where math is needed; never fabricate a value.
- External API calls go through an INJECTABLE fetcher (deps object with a default) so tests run
  OFFLINE against mocked responses — mirror lib/bio/openTargets.ts / lib/ingest/searchAndCache.ts.
- On upstream failure return an HONEST empty/null result, never a guess.
- Public routes mirror app/api/bio/target-disease/route.ts (nodejs, checkRateLimit, Zod body,
  ok/fail envelope, never log claim text). Respect licenses: ChEMBL is CC BY-SA (attribution +
  share-alike), PharmGKB is CC BY-SA 4.0 — note attribution in a comment; do NOT use DrugBank/DisGeNET.
- Deterministic verdicts use documented field-standard thresholds.`

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'filesWritten', 'dataSource', 'deterministic', 'summary'],
  properties: {
    engine: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } },
    dataSource: { type: 'string' }, deterministic: { type: 'boolean' }, summary: { type: 'string' },
    publicExports: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['engine', 'realDataSource', 'numbersDeterministic', 'tested', 'issues'],
  properties: {
    engine: { type: 'string' }, realDataSource: { type: 'boolean' }, numbersDeterministic: { type: 'boolean' },
    tested: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'detail'],
      properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, detail: { type: 'string' } } } },
  },
}

const ENGINES = [
  {
    key: 'chembl', label: 'bio:chembl-bioactivity',
    prompt: CTX + `

BUILD DRUG-TARGET BIOACTIVITY / MECHANISM VERIFICATION over ChEMBL (CC BY-SA 3.0). Own ONLY:
lib/bio/chembl.ts, lib/bio/chembl.schemas.ts, app/api/bio/bioactivity/route.ts, tests/chembl.test.ts.
lib/bio/chembl.ts (injectable fetcher; ChEMBL REST https://www.ebi.ac.uk/chembl/api/data/):
- resolveMolecule(name, deps?) -> chembl_id + pref_name + max_phase (clinical phase 0-4).
- targetBioactivities(chemblId, deps?) -> activities [{ targetChemblId, targetName, standardType
  (IC50|Ki|Kd|EC50), standardValue, standardUnits, pChembl }].
- verifyBioactivityClaim({ drug, target?, claimedPotencyNM?, claimedMechanism?, claimedPhase? }, deps?)
  -> DETERMINISTIC verdict comparing the claim to ChEMBL: potency confirmed_within_order /
  overstated / understated / not_found; phase confirmed / overstated (claimed > ChEMBL max_phase) /
  understated; with the supporting activity records. Potency comparison uses order-of-magnitude
  bands on nM (documented). NO LLM in the numeric comparison.
app/api/bio/bioactivity/route.ts: public POST, rate-limited, Zod, envelope.
tests: over MOCKED ChEMBL responses assert potency band logic (e.g. claimed 5nM vs measured 3nM ->
confirmed; claimed 0.1nM vs 50nM -> overstated), phase over/understatement, and honest not_found.`,
  },
  {
    key: 'variant', label: 'bio:variant-pathogenicity',
    prompt: CTX + `

BUILD VARIANT PATHOGENICITY VERIFICATION over ClinVar (public domain). Own ONLY:
lib/bio/variantPathogenicity.ts, lib/bio/variant.schemas.ts, app/api/bio/variant-pathogenicity/route.ts,
tests/variantPathogenicity.test.ts.
lib/bio/variantPathogenicity.ts (injectable fetcher; NCBI E-utilities esearch+esummary on clinvar db):
- lookupVariant({ rsId? , hgvs?, gene? , condition? }, deps?) -> records [{ variant, clinicalSignificance
  (Pathogenic|Likely pathogenic|VUS|Likely benign|Benign|Conflicting), condition, reviewStatus,
  starRating (0-4 mapped from review status: 'practice guideline'=4, 'reviewed by expert panel'=3,
  'criteria provided, multiple submitters, no conflicts'=2, 'criteria provided, single submitter'=1,
  else 0) }].
- verifyPathogenicityClaim({ variant, condition?, claimedSignificance? }, deps?) -> DETERMINISTIC verdict:
  confirmed / overstated_certainty (claim says pathogenic but ClinVar is VUS/benign/low-star) /
  conflicting / not_found, plus the highest-star supporting record. Star-rating + significance mapping
  are documented field-standard constants.
app/api/bio/variant-pathogenicity/route.ts: public POST, rate-limited, Zod, envelope.
tests: over MOCKED esummary responses assert star mapping, the overstated-certainty catch (claimed
Pathogenic vs a 1-star VUS), conflicting, and honest not_found.`,
  },
  {
    key: 'repurposing', label: 'bio:drug-repurposing',
    prompt: CTX + `

BUILD DRUG-REPURPOSING EVIDENCE BUNDLES — deterministically assemble the evidence for a proposed
drug<->indication link from the bio engines already built (Open Targets, ChEMBL, ClinicalTrials.gov,
FAERS). Own ONLY: lib/bio/repurposing.ts, lib/bio/repurposing.schemas.ts, app/api/bio/repurposing/route.ts,
tests/repurposing.test.ts.
lib/bio/repurposing.ts (compose existing engines via INJECTABLE deps so it tests offline):
- assembleRepurposingEvidence({ drug, indication }, deps?) -> {
    sharedTargets (Open Targets: does the drug's target associate with the indication? genetic score),
    mechanism (ChEMBL max_phase + target bioactivity if available),
    existingTrials (ClinicalTrials.gov: any trials of this drug for this indication, incl. failed),
    safety (FAERS disproportionality summary for the drug),
    score: a DETERMINISTIC composite 0-1 from the component signals (documented weighting; NO LLM),
    verdict: strong_rationale | plausible | weak | discouraged (existing failed trial / safety flag) }.
  Import the existing lib/bio + lib/sources engines; do NOT edit them. An OPTIONAL summarize() via
  callClaudeForJson+Zod writes prose over the assembled evidence only (score stays deterministic).
app/api/bio/repurposing/route.ts: public POST { drug, indication }, rate-limited, Zod, envelope.
tests: over MOCKED component signals assert the composite score + verdict logic (strong when target
associates + mechanism known + no failed trials; discouraged when a failed trial or safety flag exists).`,
  },
  {
    key: 'pharmgkb', label: 'bio:pharmacogenomics',
    prompt: CTX + `

BUILD PHARMACOGENOMIC ANNOTATION VERIFICATION over PharmGKB / ClinPGx (CC BY-SA 4.0 — attribute). Own
ONLY: lib/bio/pharmgkb.ts, lib/bio/pharmgkb.schemas.ts, app/api/bio/pharmacogenomics/route.ts,
tests/pharmgkb.test.ts.
lib/bio/pharmgkb.ts (injectable fetcher; PharmGKB/ClinPGx REST https://api.pharmgkb.org/v1/):
- lookupClinicalAnnotation({ gene?, variant?, drug }, deps?) -> annotations [{ gene, variant/allele,
  drug, phenotypeCategory (efficacy|toxicity|dosage|metabolism), evidenceLevel (1A|1B|2A|2B|3|4),
  guideline, summary }].
- verifyPgxClaim({ gene?, variant?, drug, claimedEffect? }, deps?) -> DETERMINISTIC verdict:
  high_confidence (level 1A/1B) / moderate (2A/2B) / preliminary (3/4) / not_found, plus the strongest
  annotation. Evidence-level ordering is the documented PharmGKB standard.
app/api/bio/pharmacogenomics/route.ts: public POST, rate-limited, Zod, envelope.
tests: over MOCKED PharmGKB responses assert evidence-level ordering (1A -> high_confidence), the
strongest-annotation selection, and honest not_found. Note the CC BY-SA 4.0 attribution in a comment.`,
  },
]

// PHASE 1 — BUILD -> VERIFY
phase('Build')
log('Tier-2 bio: ChEMBL bioactivity, variant pathogenicity, repurposing evidence, pharmacogenomics…')
const built = await pipeline(
  ENGINES,
  (e) => agent(e.prompt, { label: e.label, phase: 'Build', schema: BUILD_SCHEMA, effort: 'high' }),
  (build, e) => {
    if (!build) return { engine: e.key, build: null, verdict: null }
    return agent(
      CTX + '\n\nADVERSARIALLY VERIFY the "' + e.key + '" bio engine. Files: ' + (build.filesWritten || []).join(', ') + `.
Confirm: realDataSource (calls the ACTUAL API — ChEMBL / ClinVar E-utilities / composed engines /
PharmGKB — correct endpoints + parsing), numbersDeterministic (verdict/score logic is deterministic with
documented thresholds, any Claude use is summary-only), tested (the verdict/score/band logic is covered
over mocked responses; run the test). Put real problems in issues as 'blocker'; default booleans to false
if unconfirmed.`,
      { label: 'verify:' + e.key, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high', agentType: 'Explore' }
    ).then((verdict) => ({ engine: e.key, build, verdict }))
  }
)
const results = built.filter(Boolean)
const solid = results.filter((r) => r.verdict?.realDataSource && r.verdict?.numbersDeterministic && r.verdict?.tested)
log('Built ' + solid.length + '/' + results.length + ' Tier-2 bio engines (real data, deterministic, tested).')

phase('Report')
return {
  engines: results.map((r) => ({
    engine: r.engine, files: r.build?.filesWritten || [], dataSource: r.build?.dataSource || '',
    deterministic: r.build?.deterministic ?? null, realDataSource: r.verdict?.realDataSource ?? null,
    tested: r.verdict?.tested ?? null,
    blockers: (r.verdict?.issues || []).filter((i) => i.severity === 'blocker'), summary: r.build?.summary || '',
  })),
  solid: solid.length, total: results.length,
}

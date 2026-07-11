export const meta = {
  name: 'moa-adapters',
  description: 'One subagent per backend engine: write its Mixture-of-Agents Expert adapter against lib/moa/types.ts (disjoint files)',
  phases: [
    { title: 'Adapters', detail: '17 engines in parallel, each writes lib/moa/experts/<engine>.ts' },
    { title: 'Verify', detail: 'adversarial contract + build-risk review' },
  ],
}

// The shared contract every adapter implements. Given verbatim so agents do not have to
// guess the interface — they still READ the file to see the helpers, but this is the law.
const CONTRACT = [
  'PAPERTRAIL MIXTURE-OF-AGENTS (MoA). Every backend engine becomes an interchangeable',
  '"expert" agent implementing the Expert interface in lib/moa/types.ts. READ that file',
  'FIRST — it defines Expert, OrchestrationContext, MoaSource, ExpertContribution,',
  'ExpertSignal, and the helpers clamp01 / makeContribution / skippedContribution /',
  'erroredContribution / signalFromLabel. Use the helpers; do not redefine the types.',
  '',
  'YOUR DELIVERABLE: exactly ONE file, lib/moa/experts/<engine>.ts, that default-exports',
  'a const Expert. Shape:',
  '  import type { Expert, OrchestrationContext, ExpertContribution } from "../types";',
  '  import { makeContribution, skippedContribution, erroredContribution, clamp01 } from "../types";',
  '  const expert: Expert = { id, name, category, description, gate, run };',
  '  export default expert;',
  '',
  'gate(ctx): a PURE, DETERMINISTIC number in [0,1] — how relevant is this engine to the',
  'input (claim + sources + their optional metadata)? 0 means never run. Base it on real',
  'signals: e.g. a meta expert gates high only when >=2 sources contain extractable effect',
  'sizes; a trial-design expert gates high only when a source reads like a trial; a',
  'label-aggregation expert gates high only when sources carry labels. If the engine needs',
  'input that is usually absent for a plain claim, gate LOW (not 0) or 0 honestly — that is',
  'correct Mixture-of-Experts behavior. NO LLM, no I/O, no thro- in gate.',
  '',
  'run(ctx): call your engine EXISTING lib function(s) to produce an ExpertContribution.',
  'Rules:',
  '  - MUST be stateless: NO database pool, NO network beyond what the engine lib already',
  '    does internally. If your engine fundamentally needs a DB pool or a live fetch you',
  '    cannot do statelessly, gate 0 for that case and return skippedContribution with a',
  '    clear one-line reason (honest skip). Do NOT invent a pool.',
  '  - Deterministic numerics: the signal/confidence must come from the engine deterministic',
  '    outputs where the engine is deterministic. Claude may run ONLY if it already runs',
  '    inside your engine lib (pass ctx.options.llm through); set usedClaude accurately.',
  '  - Grounding: any quote you surface in groundedSpans MUST be a verbatim substring your',
  '    engine already grounded (reuse the engine grounded output). Never fabricate a span.',
  '  - NEVER throw for ordinary "no applicable input" — return skippedContribution. Wrap the',
  '    real work in try/catch and return erroredContribution(id, err) on failure.',
  '  - summary is one safe line for the UI. detail is a JSON-serializable payload for the',
  '    detail panel (ids/counts/scores — never dump raw secret data).',
  '  - Map to signal honestly: supports / refutes / mixed / insufficient / neutral. Use',
  '    neutral when your engine contributes CONTEXT or WEIGHTING (entities, source quality,',
  '    on-topic ranking, mechanism, facets) rather than a support/refute vote.',
  '',
  'FILE OWNERSHIP IS DISJOINT: create ONLY lib/moa/experts/<engine>.ts. You MAY read any',
  'file. You may make a SMALL, additive improvement to YOUR engine own lib module if it is',
  'needed to expose full functionality to the adapter (e.g. export an existing internal',
  'function) — but do NOT change its behavior, signatures used elsewhere, or numeric output,',
  'and do NOT touch lib/moa/types.ts, the router/registry/aggregator (they do not exist yet),',
  'any OTHER engine lib or adapter, shared files (lib/api/*, lib/grounding.ts, lib/claude.ts,',
  'middleware.ts, layout.tsx), or migrations. TypeScript strict, no any, no TODOs.',
].join('\n')

// Per-engine spec: id, category, route to read for the shape, lib entrypoint hint, and the
// gate/signal guidance specific to that engine. Agents READ the named lib + route to learn
// exact signatures before writing.
const ENGINES = [
  {
    id: 'minicheck', category: 'verification',
    body:
      'MiniCheck — negation-aware presence/absence entailment. lib: lib/grounding/negationEntailment.ts' +
      ' (verifyAbsenceClaim(input, deps?), detectPolarity). route: app/api/verify/absence-claim/route.ts.' +
      ' gate: high (~0.9) whenever there is >=1 source and the claim is verifiable as presence/absence' +
      ' (always applicable to efficacy/safety claims). run: for each source, verifyAbsenceClaim({claim,' +
      ' source_text}, with llm from ctx.options.llm); pick the highest-confidence result; map its label' +
      ' -> signal (supported/negative_supported -> supports, refuted -> refutes, nei -> insufficient);' +
      ' surface the grounded supporting span. usedClaude = ctx.options.llm.',
  },
  {
    id: 'loki', category: 'retrieval',
    body:
      'Loki/OpenFactVerification — claim-frame on-topic reranker. lib: lib/agents/contextualRank.ts' +
      ' (rankByClaimFrame(claim, sources, {llm})). route: app/api/retrieval/rerank/route.ts. gate: high' +
      ' (~0.8) when >=2 sources (relevance triage adds value), ~0.3 for 1 source. run: rankByClaimFrame' +
      ' over ctx.sources ({id,text}) with llm = ctx.options.llm; signal = neutral (it triages relevance,' +
      ' it does not vote); confidence = top ranked score; detail = ranked ids+scores + droppedIds; if a' +
      ' grounded on-topic quote exists, add it to groundedSpans. usedClaude = ctx.options.llm.',
  },
  {
    id: 'multivers', category: 'verification',
    body:
      'MultiVerS — confidence-weighted cross-source label aggregation. lib:' +
      ' lib/scieval/crossSourceAggregate.ts (aggregateCrossSource(perSource[])). route:' +
      ' app/api/scieval/aggregate/route.ts. gate: high (~0.85) ONLY when >=2 sources carry a `label`' +
      ' (SUPPORTS/REFUTES/NEI); else gate 0 (honest — it aggregates existing labels, it does not create' +
      ' them). run: map ctx.sources with labels -> aggregateCrossSource; map verdict (supported->supports,' +
      ' refuted->refutes, mixed->mixed, insufficient->insufficient); confidence = netConfidence; detail =' +
      ' tally. Deterministic, usedClaude=false. If <2 labeled sources -> skippedContribution.',
  },
  {
    id: 'valsci', category: 'verification',
    body:
      'Valsci — quantitative contradiction atlas (resolve WHY sources disagree). Find its lib by reading' +
      ' route app/api/verify/contradiction-resolve/route.ts and the module it imports (likely under' +
      ' lib/scieval or lib/contradiction). gate: high (~0.8) when >=2 sources AND there is plausible' +
      ' disagreement (e.g. mixed labels, or both a reduction and no-effect present); moderate (~0.3)' +
      ' otherwise. run: call the atlas builder over ctx.claim + ctx.sources; signal = mixed when a' +
      ' contradiction is attributed, else neutral/insufficient; confidence from the resolution strength;' +
      ' detail = resolution_category + attributions; surface grounded feature quotes. usedClaude =' +
      ' ctx.options.llm (it uses a Claude feature tagger). If the lib needs inputs you cannot supply' +
      ' statelessly, gate accordingly and skip honestly.',
  },
  {
    id: 'storm', category: 'verification',
    body:
      'STORM — structured debate for MIXED verdicts. lib: lib/synthesis/debate.ts (buildDebate(input,' +
      ' deps), defaultDebateDeps). route: app/api/synthesis/debate/route.ts. gate: high (~0.8) ONLY when' +
      ' BOTH a supporting and a refuting side exist among ctx.sources (derive sides from source.label:' +
      ' SUPPORTS->supporting, REFUTES->refuting); else gate 0 (a debate needs two sides). run: buildDebate' +
      ' with defaultDebateDeps (Claude writes only connective prose; llm honored via deps only when' +
      ' ctx.options.llm) -> map stance (leans_supported->supports, leans_refuted->refutes,' +
      ' balanced_mixed->mixed, one_sided/insufficient->insufficient); confidence from the margin; detail =' +
      ' the debate sections summary; groundedSpans = the debate grounded quotes. usedClaude = ctx.options.llm.' +
      ' If you cannot split into two non-empty grounded sides -> skippedContribution.',
  },
  {
    id: 'paperqa', category: 'meta',
    body:
      'paper-qa — source-quality tiers (weighting expert). lib: lib/paperqa/sourceQuality.ts' +
      ' (scoreSourceQuality(meta), scoreSourceQualityBatch). route: app/api/sources/quality-tier/route.ts.' +
      ' gate: moderate (~0.5) whenever >=1 source (it can always tier from available metadata/defaults).' +
      ' run: score each ctx.source from its metadata (journal/year/citations/isPreprint/isOpenAccess/' +
      ' retracted); signal = neutral (it WEIGHTS, does not vote); confidence = mean quality weight; detail' +
      ' = per-source {id, tier, weight}; if any source is retracted, note it prominently. Deterministic,' +
      ' usedClaude=false.',
  },
  {
    id: 'r2r', category: 'retrieval',
    body:
      'R2R — RAG-fusion facet decomposition + coverage. Read route app/api/retrieval/hybrid/route.ts and' +
      ' the facet/decompose lib it uses (likely lib/retrieval/hybrid.ts or lib/research/*). For the MoA' +
      ' adapter, do a STATELESS facet analysis: decompose the claim into efficacy/safety/mechanism/' +
      ' subgroup facets and score how many ctx.sources cover each facet (deterministic keyword coverage —' +
      ' reuse the existing facet decomposition function if it is pure; do NOT do DB retrieval here). gate:' +
      ' moderate (~0.5) when >=1 source. signal = neutral (context/coverage); confidence = fraction of' +
      ' facets covered; detail = per-facet covered-source counts. usedClaude=false. If the only facet fn' +
      ' requires a DB pool, implement a small pure keyword-coverage fallback INSIDE your adapter file.',
  },
  {
    id: 'iterative', category: 'meta',
    body:
      'open_deep_research — evidence-sufficiency assessor. lib: lib/research/iterativeLoop.ts' +
      ' (planIterativeRounds) and lib/evidencePipeline.ts (evidenceSufficiency). route:' +
      ' app/api/deep-research/iterative/route.ts. For the adapter, build ONE RoundStats deterministically' +
      ' from ctx.sources: k = source count; participants = sum of enrollment numbers you can parse from' +
      ' source text (simple regex like "n = 1234" / "enrolled 1234"); iSquared/openContradictions = 0 if' +
      ' unknown. Call evidenceSufficiency (do NOT edit it). gate: moderate (~0.5) when >=1 source. signal =' +
      ' insufficient when not sufficient, neutral when sufficient (it assesses body-of-evidence adequacy,' +
      ' it does not vote for/against); confidence = a documented function of how many criteria pass; detail' +
      ' = the sufficiency result + any widen action. Deterministic, usedClaude=false.',
  },
  {
    id: 'pymare', category: 'meta',
    body:
      'PyMARE — Bayesian random-effects meta-analysis (quantitative expert). Read routes' +
      ' app/api/meta/bayesian/route.ts + app/api/meta/sensitivity/route.ts and the lib they use (under' +
      ' lib/meta). Use the existing effect-size extractor (lib/effectSize.ts — reconcile/extract; READ it,' +
      ' do NOT edit) to parse HR/RR/OR + CI from each ctx.source text. gate: HIGH (~0.9) when >=2 sources' +
      ' yield extractable effect sizes; 0 otherwise (nothing to pool). run: pool the extracted effects with' +
      ' the Bayesian meta lib; compare the pooled effect direction to the claim direction -> signal supports' +
      ' (pooled effect agrees and CI excludes null), refutes (pooled effect contradicts the claim), mixed/' +
      ' insufficient (CI spans null or high heterogeneity); confidence from CI width / posterior. detail =' +
      ' pooled estimate + credible/prediction interval + k. Deterministic, usedClaude=false. If <2 effect' +
      ' sizes -> skippedContribution.',
  },
  {
    id: 'pytrials', category: 'sources',
    body:
      'pytrials — trial eligibility parse + design-credibility prior (weighting expert). lib:' +
      ' lib/sources/trialDesign.ts (parseEligibility, scoreDesignCredibility). route:' +
      ' app/api/trials/design/route.ts. gate: moderate (~0.6) when a source reads like a clinical trial' +
      ' (mentions randomized/double-blind/placebo/enrollment/phase/eligibility) else 0. run: for the most' +
      ' trial-like source, parseEligibility(text) + scoreDesignCredibility(parsed design fields you can' +
      ' infer deterministically from the text: randomized?, blinding, enrollment band, phase). signal =' +
      ' neutral (it WEIGHTS trial-source credibility, does not vote); confidence = priorWeight; detail =' +
      ' {tier, priorWeight, gates, factors}. Deterministic, usedClaude=false.',
  },
  {
    id: 'indra', category: 'bio-kg',
    body:
      'INDRA — mechanism/causal-statement assembly (context expert). Read route app/api/mechanism/route.ts' +
      ' and its lib (under lib/mechanism, e.g. assemble.ts / context.ts). For the adapter, run the' +
      ' STATELESS extraction path over ctx.claim + the concatenated ctx.sources text: extract grounded' +
      ' causal statements (subject-relation-object with a verbatim quote). Do NOT write to any KG / DB —' +
      ' if the only entry point upserts to a pool, use the pure extract function only, or skip honestly.' +
      ' gate: moderate (~0.5) when the claim is mechanistic/causal (contains cause/increase/reduce/inhibit/' +
      ' activate/via) and >=1 source. signal = neutral (mechanism is corroborating context); confidence =' +
      ' combined belief; detail = the extracted statements (subject/rel/object/belief); groundedSpans =' +
      ' the grounded quotes. usedClaude = ctx.options.llm (extraction uses Claude).',
  },
  {
    id: 'scispacy', category: 'bio-kg',
    body:
      'scispaCy — biomedical NER + entity linking (context expert). Read route app/api/entities/route.ts' +
      ' and its lib (lib/entities/ner.ts). Run the STATELESS mention-extraction path over ctx.claim +' +
      ' ctx.sources text: propose mentions, ground them, link to CURIEs. Do NOT require a DB. gate: low-' +
      ' moderate (~0.4) when >=1 source (entities are always useful context). signal = neutral; confidence' +
      ' = a documented function of how many entities were grounded+linked; detail = linked entities' +
      ' {text, curie, type}; groundedSpans = grounded mention spans. usedClaude = ctx.options.llm (NER uses' +
      ' Claude).',
  },
  {
    id: 'pyalex', category: 'sources',
    body:
      'pyalex — OpenAlex citation-velocity signal. Read route app/api/sources/openalex/route.ts (and any' +
      ' living-evidence velocity lib). This needs a live OpenAlex fetch / DOI, which is NOT available' +
      ' statelessly in the orchestrate path. So gate 0 unless a ctx.source carries a doi AND you can' +
      ' compute velocity purely from fields already present on the source; realistically gate 0 and return' +
      ' skippedContribution("needs OpenAlex ingestion context — run via Living Evidence"). This is the' +
      ' honest MoE skip. Still create the adapter file with a correct gate + skip so the engine is' +
      ' REGISTERED and fires when velocity data is provided later.',
  },
  {
    id: 'pykeen', category: 'bio-kg',
    body:
      'PyKEEN — learned KG link prediction. Read route app/api/kg/predict/learned/route.ts and its lib' +
      ' (lib/kg/*). Training TransE per request over the org KG needs a DB pool and is not stateless. gate' +
      ' 0 for the plain claim path and return skippedContribution("needs a built knowledge graph — run via' +
      ' Knowledge Graph"). Create the adapter file with the correct gate + skip so PyKEEN is REGISTERED and' +
      ' can fire when KG context is supplied. Do NOT open a DB pool.',
  },
  {
    id: 'biocypher', category: 'bio-kg',
    body:
      'BioCypher — bring-your-own-KG CSV import with Biolink typing. lib: lib/kg/byoKg.ts. route:' +
      ' app/api/kg/import/route.ts. This is an INGESTION tool needing nodes/edges CSVs + a DB pool, not a' +
      ' claim verifier. gate 0 in the claim path; return skippedContribution("KG import tool — supply' +
      ' nodes/edges via Knowledge Graph import"). Create the adapter file with correct gate + skip so it is' +
      ' REGISTERED. Do NOT open a DB pool. You MAY, additionally, expose a pure Biolink typing check from' +
      ' lib/kg/biolink.ts if trivially useful, but do not require it.',
  },
  {
    id: 'asreview', category: 'screening',
    body:
      'ASReview — ensemble abstract screening. lib: lib/screening/ensemble.ts (ensembleScreen(labeled,' +
      ' unlabeled)). route: app/api/screening/ensemble/route.ts. Screening needs labeled + unlabeled' +
      ' abstract SETS, which a single claim+sources context does not provide. gate 0 in the claim path and' +
      ' return skippedContribution("screening needs a labeled/unlabeled abstract set — run via Screening").' +
      ' Create the adapter file with correct gate + skip so ASReview is REGISTERED and fires when a' +
      ' screening set is present in ctx (if you can detect one on ctx, gate it in and run ensembleScreen).',
  },
  {
    id: 'evidence-integrator', category: 'sources',
    body:
      'Evidence integrator (FAERS / ClinVar / ChEMBL) — live pharmacovigilance/variant/bioactivity ingest.' +
      ' These do live network fetch + caching and are ingestion, not stateless claim verification. gate 0' +
      ' in the orchestrate path and return skippedContribution("live FAERS/ClinVar/ChEMBL lookup — run via' +
      ' Source Ingest"). Create ONE adapter file lib/moa/experts/evidence-integrator.ts with the correct' +
      ' gate + skip so this engine cluster is REGISTERED in the MoA. Do NOT perform network I/O here.',
  },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'file', 'gateSummary', 'signalMapping', 'usedClaude'],
  properties: {
    id: { type: 'string' },
    file: { type: 'string' },
    gateSummary: { type: 'string' },
    signalMapping: { type: 'string' },
    usedClaude: { type: 'boolean' },
    engineLibTouched: { type: 'string', description: 'the engine own lib file additively changed, or "none"' },
    notes: { type: 'string' },
  },
}

phase('Adapters')
const built = (await parallel(
  ENGINES.map((e) => () =>
    agent(
      [
        'Write the PaperTrail MoA Expert adapter for ONE backend engine: ' + e.id + ' (category: ' + e.category + ').',
        '',
        CONTRACT,
        '',
        'YOUR ENGINE:',
        e.body,
        '',
        'Create exactly lib/moa/experts/' + e.id + '.ts (default-export the Expert). Ship complete, typed,',
        'strict code — no any, no TODOs. Do NOT run npm/tsc. Return your file path + how you gate + your',
        'signal mapping + whether run() invokes Claude.',
      ].join('\n'),
      { label: 'adapter:' + e.id, phase: 'Adapters', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review the PaperTrail MoA Expert adapters. READ lib/moa/types.ts (the contract), then',
    'EVERY file under lib/moa/experts/. For each adapter verify: it default-exports a valid Expert; gate()',
    'is pure/deterministic and returns [0,1]; run() never throws for "no input" (uses skippedContribution)',
    'and wraps work in try/catch (erroredContribution); it does NOT open a DB pool or do disallowed network',
    'I/O; usedClaude is set truthfully (true ONLY if a Claude call actually happens and ctx.options.llm was',
    'honored); groundedSpans are only ever verbatim engine-grounded quotes; signal mapping is honest;',
    'imports resolve (correct relative paths, correct exported names from the engine lib). Also flag any',
    'TypeScript build risk (bad import name, wrong signature, any-usage, missing default export) and any',
    'engine-lib edit that changed existing behavior/signatures. Report concrete issues with file + fix.',
  ].join('\n'),
  { label: 'verify:adapters', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('MoA adapters: ' + built.length + ' engines adapted; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }

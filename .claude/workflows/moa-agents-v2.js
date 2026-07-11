export const meta = {
  name: 'moa-agents-v2',
  description: 'Rewrite every engine as a COMPOSING MoA agent (produces/consumes blackboard artifacts) + 4 new agents',
  phases: [
    { title: 'Agents', detail: '21 agents in parallel, each writes lib/moa/agents/<id>.ts with real produce/consume wiring' },
    { title: 'Verify', detail: 'adversarial composition + build-risk review' },
  ],
}

const CONTRACT = [
  'PAPERTRAIL MIXTURE-OF-AGENTS v2 — REAL COMPOSITION. Agents do NOT run blind and get summed.',
  'They compose through a typed shared BLACKBOARD: enricher agents PRODUCE artifacts; verifier',
  'and deliberation agents CONSUME upstream artifacts and build on them. READ lib/moa/types.ts',
  'FIRST — it is the law. Key types: MoaAgent, OrchestrationContext, AgentContribution, Blackboard,',
  'ArtifactKind, and the artifact payload types (EntityMention, SourceRelevance, ParsedEffectSize,',
  'SourceQuality, DesignPrior, CausalStatement, SourceLabel, ContestedFinding, SufficiencyFinding,',
  'DebateFinding, ResearchBriefFinding). Helpers: clamp01, makeContribution, skippedContribution,',
  'erroredContribution, signalFromLabel. ALSO read lib/moa/blackboard.ts + lib/moa/scheduler.ts to',
  'see how produced artifacts are committed between layers.',
  '',
  'YOUR DELIVERABLE: exactly ONE file, lib/moa/agents/<id>.ts, default-exporting a const MoaAgent:',
  '  import type { MoaAgent, OrchestrationContext, AgentContribution, Blackboard } from "../types";',
  '  import { makeContribution, skippedContribution, erroredContribution, clamp01 } from "../types";',
  '  const agent: MoaAgent = { id, name, category, description, produces, consumes, gate, run };',
  '  export default agent;',
  '',
  'produces: readonly ArtifactKind[] — the artifact kinds run() writes back (via the returned',
  '  contribution.produced map). MUST match what you actually return in produced.',
  'consumes: readonly ArtifactKind[] — the artifact kinds run() reads from the blackboard. The',
  '  scheduler uses produces/consumes to ORDER agents into layers: a consumer runs AFTER its',
  '  producers and can read their output via bb.get(kind). MUST match what you actually read.',
  '',
  'gate(ctx): PURE, DETERMINISTIC [0,1] from the INPUT ONLY (never the blackboard — gate runs',
  '  before scheduling). 0 = never participates. A consumer gates on ELIGIBILITY (e.g. ">=2',
  '  sources exist, so upstream labels will be produced"), and if at run() the consumed artifact',
  '  turns out absent/empty, returns skippedContribution. No LLM/IO/throw in gate.',
  '',
  'run(ctx, bb): read upstream artifacts with bb.get("kind") (typed), do the work by calling your',
  '  engine EXISTING lib function(s), and return makeContribution(id, { signal, confidence, summary,',
  '  detail, groundedSpans, usedClaude, produced }). Rules:',
  '   - COMPOSE: consumers MUST actually use bb.get(...) results (this is the whole point). If a',
  '     consumed artifact is missing, degrade honestly (skippedContribution or lower confidence).',
  '   - Producers MUST return produced: { <kind>: <payload matching the type in types.ts> }.',
  '   - Stateless: NO database pool, NO network beyond what the engine lib already does. If the',
  '     engine truly needs a pool/live fetch, gate 0 and skippedContribution (honest MoE skip).',
  '   - Deterministic numerics; Claude only if it already runs inside your engine lib (pass',
  '     ctx.options.llm through) — set usedClaude truthfully. Grounded spans are only ever verbatim',
  '     engine-grounded substrings; never fabricate. NEVER throw for "no input" (skippedContribution);',
  '     wrap real work in try/catch -> erroredContribution(id, err).',
  '   - summary = one safe UI line. detail = JSON-serializable ids/counts/scores (never raw secrets).',
  '',
  'A v1 adapter for most engines exists at backend/moa-v1-adapters/<id>.ts — READ it to reuse the',
  'engine lib call + grounding, but you must UPGRADE it to the v2 composition contract (produces/',
  'consumes + bb + produced). FILE OWNERSHIP DISJOINT: create ONLY lib/moa/agents/<id>.ts (+ for the',
  'research agents, your backend/engines/<repo>/papertrail_*.py + PAPERTRAIL.md). You MAY additively',
  'export an existing internal fn from YOUR engine lib if needed, but do NOT change behavior/signatures,',
  'and do NOT touch lib/moa/types.ts, blackboard.ts, scheduler.ts, router.ts, aggregate.ts, registry.ts,',
  'other agents, shared files, or migrations. TS strict, no any, no TODOs.',
].join('\n')

const AGENTS = [
  // ---- LAYER 1 · ENRICHERS (produce artifacts, signal neutral) ----
  {
    id: 'scispacy', cat: 'enricher',
    body:
      'scispaCy entity enricher. produces: ["entities"]; consumes: []. lib: lib/entities/ner.ts (stateless' +
      ' mention extraction + grounding + CURIE linking; NO DB). gate: 0.4 when >=1 source with text, else 0.' +
      ' run: extract grounded mentions over claim + each source text; build EntityMention[] {sourceId, text,' +
      ' curie, type, span}; return produced:{ entities: EntityMention[] }, signal neutral, confidence = a' +
      ' documented function of how many mentions grounded+linked, groundedSpans = the grounded mention spans.' +
      ' usedClaude = ctx.options.llm (NER uses Claude). If no entities -> skippedContribution (still no error).',
  },
  {
    id: 'quant-extractor', cat: 'enricher',
    body:
      'NEW native effect-size extractor (no v1 adapter). produces: ["effect_sizes"]; consumes: []. lib:' +
      ' lib/effectSize.ts (parseEffectSizes — READ it, do NOT edit). gate: 0.5 when >=1 source, else 0. run:' +
      ' for each source, parseEffectSizes(source.text); keep ratio measures (HR/RR/OR) with ordered positive' +
      ' CI; build ParsedEffectSize[] {sourceId, measure, point, ciLow, ciHigh, raw}; return produced:{' +
      ' effect_sizes: ParsedEffectSize[] }, signal neutral, confidence = clamp01(count/ (count+2)), detail =' +
      ' per-source measures. Deterministic, usedClaude=false. Groundedspans: one per extracted effect using the' +
      ' verbatim raw substring located in the source (use lib/grounding.locateSpan; drop if not found).' +
      ' If 0 effects extracted -> skippedContribution.',
  },
  {
    id: 'paperqa', cat: 'enricher',
    body:
      'paper-qa source-quality enricher. produces: ["quality"]; consumes: []. lib: lib/paperqa/sourceQuality.ts' +
      ' (scoreSourceQuality / scoreSourceQualityBatch). gate: 0.5 when >=1 source, else 0. run: score each source' +
      ' from metadata; build SourceQuality { weightById: {sourceId:{tier,weight}}, meanWeight, retractedIds };' +
      ' return produced:{ quality }, signal neutral, confidence = meanWeight, and IMPORTANT set' +
      ' detail.qualityWeight = meanWeight (the aggregator reads this as a trust multiplier). Deterministic,' +
      ' usedClaude=false. Flag retracted sources prominently in summary.',
  },
  {
    id: 'loki', cat: 'retrieval',
    body:
      'Loki relevance enricher. produces: ["relevance"]; consumes: ["entities"] (optional — may read entities to' +
      ' inform, but works without). lib: lib/agents/contextualRank.ts (rankByClaimFrame(claim, sources, {llm})).' +
      ' gate: 0.8 when >=2 sources, 0.3 for 1, 0 for 0. run: rankByClaimFrame over ctx.sources with llm =' +
      ' ctx.options.llm; build SourceRelevance { rankById: {sourceId: score}, droppedIds }; return produced:{' +
      ' relevance }, signal neutral, confidence = top score, groundedSpans = grounded on-topic quotes if any.' +
      ' usedClaude = ctx.options.llm.',
  },
  {
    id: 'pytrials', cat: 'sources',
    body:
      'pytrials design-prior enricher. produces: ["design_priors"]; consumes: []. lib: lib/sources/trialDesign.ts' +
      ' (parseEligibility, scoreDesignCredibility). gate: 0.6 when any source reads like a trial (randomized/' +
      ' double-blind/placebo/enrollment/phase/eligibility present), else 0. run: for each trial-like source,' +
      ' scoreDesignCredibility(inferred design fields); build DesignPrior[] {sourceId, tier, priorWeight};' +
      ' return produced:{ design_priors }, signal neutral, confidence = mean priorWeight, detail = per-source' +
      ' tier/weight/factors. Deterministic, usedClaude=false.',
  },
  {
    id: 'indra', cat: 'bio-kg',
    body:
      'INDRA mechanism enricher. produces: ["mechanisms"]; consumes: ["entities"] (optional). Read route' +
      ' app/api/mechanism/route.ts + its lib (lib/mechanism/*). Use ONLY the stateless extract path (NO KG/DB' +
      ' upsert). gate: 0.5 when the claim is mechanistic/causal (cause/increase/reduce/inhibit/activate/via) and' +
      ' >=1 source, else 0.15. run: extract grounded causal statements over claim + sources; build' +
      ' CausalStatement[] {subject, relation, object, belief, span}; return produced:{ mechanisms }, signal' +
      ' neutral, confidence = combined belief, groundedSpans = the grounded quotes. usedClaude = ctx.options.llm.' +
      ' If the only entry point writes to a pool, use the pure extractor only or skip honestly.',
  },
  {
    id: 'r2r', cat: 'retrieval',
    body:
      'R2R facet-coverage enricher. produces: []; consumes: ["entities"] (optional). Read app/api/retrieval/' +
      'hybrid/route.ts + the facet decomposition lib. STATELESS ONLY: decompose the claim into efficacy/safety/' +
      'mechanism/subgroup facets and score deterministic keyword coverage of each facet across ctx.sources (no' +
      ' DB retrieval). gate: 0.45 when >=1 source. signal neutral; confidence = fraction of facets covered;' +
      ' detail = per-facet covered-source counts. usedClaude=false. Implement a small pure keyword-coverage' +
      ' fallback in your file if the existing facet fn needs a pool.',
  },
  // ---- LAYER 2 · VERIFIERS (consume enrichers, vote; minicheck+valsci also produce) ----
  {
    id: 'minicheck', cat: 'verification',
    body:
      'MiniCheck entailment verifier — THE KEY PRODUCER of source_labels. produces: ["source_labels"]; consumes:' +
      ' ["relevance","quality"]. lib: lib/grounding/negationEntailment.ts (verifyAbsenceClaim). gate: 0.9 when' +
      ' >=1 source, 0 otherwise. run: read relevance = bb.get("relevance") and SKIP sources in' +
      ' relevance.droppedIds (off-topic); read quality = bb.get("quality") and DOWN-WEIGHT each label confidence' +
      ' by that source weight. For each remaining source, verifyAbsenceClaim({claim, sourceText},' +
      ' llm=ctx.options.llm) -> a per-source SourceLabel {sourceId, label(SUPPORTS/REFUTES/NEI), confidence,' +
      ' span}. RETURN produced:{ source_labels: SourceLabel[] } (this is what MultiVerS/Valsci/STORM consume).' +
      ' The agent VOTE = the strongest decisive label mapped via signalFromLabel; confidence = that label' +
      ' confidence; groundedSpans = its grounded span. usedClaude = ctx.options.llm. If llm is false (engine has' +
      ' no deterministic-only path) -> skippedContribution.',
  },
  {
    id: 'multivers', cat: 'verification',
    body:
      'MultiVerS aggregation verifier — CONSUMES MiniCheck labels (the composition fix). produces: []; consumes:' +
      ' ["source_labels","quality"]. lib: lib/scieval/crossSourceAggregate.ts (aggregateCrossSource). gate:' +
      ' eligible 0.7 when >=2 sources (MiniCheck will produce labels), else 0. run: labels = bb.get(' +
      '"source_labels"); if missing or <2 labels -> skippedContribution("no upstream labels to aggregate").' +
      ' Optionally weight by bb.get("quality"). aggregateCrossSource(labels mapped to its input) -> map verdict' +
      ' (supported->supports, refuted->refutes, mixed->mixed, insufficient->insufficient); confidence =' +
      ' clamp01(abs(netConfidence)); detail = tally + which agent produced the labels (bb producerOf). No LLM.',
  },
  {
    id: 'pymare', cat: 'meta',
    body:
      'PyMARE Bayesian meta verifier — CONSUMES quant-extractor effect_sizes. produces: []; consumes:' +
      ' ["effect_sizes"]. lib: lib/metaBayesian.ts (bayesianMetaAnalyze) + lib/effectSize.ts' +
      ' (claimedReductionPercent) + lib/metaAnalysis.ts (RatioMeasure/StudyEffectInput). gate: eligible 0.85' +
      ' when >=2 sources (effects will be produced), else 0. run: effects = bb.get("effect_sizes"); if missing' +
      ' or <2 -> skippedContribution. Pool the effects (pick the dominant ratio measure) with bayesianMetaAnalyze;' +
      ' compare pooled direction to the claim (claimedReductionPercent) -> supports (agrees + CI excludes null),' +
      ' refutes (contradicts), mixed/insufficient (CI spans null / high heterogeneity); confidence from CI width;' +
      ' detail = pooled estimate + interval + k; groundedSpans = the effect `raw` substrings. Deterministic,' +
      ' usedClaude=false.',
  },
  {
    id: 'valsci', cat: 'verification',
    body:
      'Valsci contradiction verifier — CONSUMES labels+entities, PRODUCES contested (for STORM). produces:' +
      ' ["contested"]; consumes: ["source_labels","entities"]. Read app/api/verify/contradiction-resolve/route.ts' +
      ' + its lib. gate: 0.8 when >=2 sources and disagreement is plausible (mixed upstream labels OR opposing' +
      ' directional cues), else 0.2 floor when >=2 sources. run: use source_labels = bb.get("source_labels") to' +
      ' identify disagreeing sides + resolve WHY (dimension); PRODUCE contested: ContestedFinding {sourceIds' +
      ' (the conflicting ones), dimension, category}; VOTE mixed when a contradiction is attributed, neutral for' +
      ' no_conflict, insufficient otherwise; confidence from resolution strength; groundedSpans = grounded' +
      ' feature quotes. usedClaude = ctx.options.llm (feature tagger). If llm false or the atlas needs a pool it' +
      " cannot get statelessly, degrade (omit the mechanism dep like the route does) or skip honestly.",
  },
  // ---- LAYER 3 · DELIBERATION (consume verifier output) ----
  {
    id: 'storm', cat: 'deliberation',
    body:
      'STORM debate agent — CONSUMES MiniCheck labels + Valsci contested. produces: ["debate"]; consumes:' +
      ' ["source_labels","contested"]. lib: lib/synthesis/debate.ts (buildDebate, defaultDebateDeps). gate:' +
      ' eligible 0.6 when >=2 sources (labels will split the sides), else 0. run: labels = bb.get(' +
      '"source_labels"); split ctx.sources into supporting (SUPPORTS) and refuting (REFUTES) using the labels;' +
      ' if bb.get("contested") is present, prioritize those sourceIds. If not both sides non-empty ->' +
      ' skippedContribution("no two grounded sides to debate"). buildDebate(defaultDebateDeps, llm honored) ->' +
      ' PRODUCE debate: DebateFinding {stance, supportingCount, refutingCount, margin}; VOTE stance mapped' +
      ' (leans_supported->supports, leans_refuted->refutes, balanced_mixed->mixed, one_sided/insufficient->' +
      ' insufficient); groundedSpans = debate grounded quotes. usedClaude = ctx.options.llm.',
  },
  {
    id: 'iterative', cat: 'deliberation',
    body:
      'open_deep_research sufficiency agent — CONSUMES effect_sizes. produces: ["sufficiency"]; consumes:' +
      ' ["effect_sizes"]. lib: lib/research/iterativeLoop.ts + lib/evidencePipeline.ts (evidenceSufficiency).' +
      ' gate: 0.5 when >=1 source. run: build ONE RoundStats from ctx.sources (k = source count; participants =' +
      ' sum of enrollment numbers parsed from text; use effect_sizes = bb.get("effect_sizes") count as another' +
      ' signal of quantitative evidence); evidenceSufficiency -> PRODUCE sufficiency: SufficiencyFinding' +
      ' {sufficient, reasons, k, participants}; VOTE insufficient when not sufficient, neutral when sufficient;' +
      ' confidence = fraction of criteria passed; detail = the sufficiency result. Deterministic, usedClaude=false.',
  },
  {
    id: 'autoreview', cat: 'deliberation',
    body:
      'NEW research agent autoreview (productionize eimenhmdt/autoresearcher = citation-grounded literature' +
      ' review). ALSO create backend/engines/autoresearcher-eimenhmdt/papertrail_review.py (stdlib-only,' +
      ' argparse, JSON in/out, {"error":...}+exit 2, py_compile-clean: given a claim + labeled/weighted sources,' +
      ' deterministically assemble a citation-grounded review skeleton — which sources support/refute, ordered' +
      ' by quality weight) + PAPERTRAIL.md. produces: ["research_brief"]; consumes: ["source_labels","quality",' +
      '"entities"]. gate: 0.5 when >=2 sources. run: read source_labels + quality from bb; assemble a grounded' +
      ' review: pick the top grounded supporting + refuting spans (from the labels), ordered by quality weight;' +
      ' if ctx.options.llm, Claude writes ONLY connective prose grounded in those spans (reuse the debate/' +
      ' synthesize grounding pattern — every quote verbatim via lib/grounding.locateSpan, drop ungroundable);' +
      ' PRODUCE research_brief: ResearchBriefFinding {summary, citations: GroundedSpan[]}; VOTE neutral (a review' +
      ' summarizes; it does not add an independent vote) with confidence = coverage; groundedSpans = the review' +
      ' citations. usedClaude = ctx.options.llm. If <2 grounded sources -> skippedContribution.',
  },
  {
    id: 'autogather', cat: 'deliberation',
    body:
      'NEW research agent autogather (productionize lucereal/AutoResearcher = query-generation + coverage-gap' +
      ' analysis, TRUSTED biomedical sources only, NO social media / NO live fetch in orchestrate). ALSO create' +
      ' backend/engines/autoresearcher-lucereal/papertrail_gather.py (stdlib-only, argparse, JSON in/out,' +
      ' {"error":...}+exit 2: given a claim + entities, deterministically generate sub-queries per facet and' +
      ' report which are covered by the provided sources vs GAPS) + PAPERTRAIL.md. produces: []; consumes:' +
      ' ["entities","relevance"]. gate: 0.4 when >=1 source. run: read entities + relevance from bb; generate' +
      ' deterministic sub-queries (facet x key entities) and measure coverage across ctx.sources; VOTE neutral' +
      ' (or insufficient if major gaps); confidence = coverage fraction; detail = {subQueries, covered, gaps}.' +
      ' Stateless, usedClaude=false (pure query-gen + coverage). Do NOT do any network I/O.',
  },
  {
    id: 'autoloop', cat: 'deliberation',
    body:
      'NEW research agent autoloop (productionize karpathy/autoresearch PATTERN = propose->evaluate->keep/discard' +
      ' bounded loop, adapted to EVIDENCE refinement, NOT GPU training). ALSO create backend/engines/' +
      'autoresearch-karpathy/papertrail_loop.py (stdlib-only, argparse, JSON in/out, {"error":...}+exit 2: a' +
      ' deterministic bounded state machine that, given current sufficiency + effect stats, proposes the next' +
      ' refinement action (sharpen sub-question / widen population / add endpoint) and decides continue|stop' +
      ' with a hard round cap) + PAPERTRAIL.md. produces: []; consumes: ["sufficiency","effect_sizes"]. gate:' +
      ' 0.4 when >=1 source. run: read sufficiency + effect_sizes from bb; deterministically decide the next' +
      ' bounded refinement step + whether current evidence is stop-worthy; VOTE neutral (or insufficient if the' +
      ' loop says "need more evidence"); confidence = documented; detail = {proposedNextStep, stop, roundsCap}.' +
      ' Deterministic, bounded, usedClaude=false. NO network, NO GPU, NO training — evidence logic only.',
  },
  // ---- REGISTERED-BUT-USUALLY-SKIP (need context absent for a plain claim) ----
  {
    id: 'asreview', cat: 'screening',
    body:
      'ASReview ensemble screening. produces: []; consumes: []. lib: lib/screening/ensemble.ts (ensembleScreen).' +
      ' Screening needs labeled+unlabeled ABSTRACT SETS which a claim+sources context lacks. gate: 0 in the claim' +
      ' path; return skippedContribution("screening needs a labeled/unlabeled abstract set — run via Screening").' +
      ' Create the file so ASReview stays REGISTERED and fires when a screening set is present.',
  },
  {
    id: 'pyalex', cat: 'sources',
    body:
      'pyalex citation velocity. produces: []; consumes: []. Needs a live OpenAlex fetch/DOI — not stateless.' +
      ' gate: 0; return skippedContribution("needs OpenAlex ingestion context — run via Living Evidence").' +
      ' Create the file so pyalex stays REGISTERED. No network I/O.',
  },
  {
    id: 'pykeen', cat: 'bio-kg',
    body:
      'PyKEEN learned link prediction. produces: []; consumes: []. Training TransE over the org KG needs a DB' +
      ' pool — not stateless. gate: 0; return skippedContribution("needs a built knowledge graph — run via' +
      ' Knowledge Graph"). Create the file so PyKEEN stays REGISTERED. No DB pool.',
  },
  {
    id: 'biocypher', cat: 'bio-kg',
    body:
      'BioCypher BYO-KG import. produces: []; consumes: []. Ingestion tool needing CSVs + a DB pool. gate: 0;' +
      ' return skippedContribution("KG import tool — supply nodes/edges via Knowledge Graph import"). Create the' +
      ' file so BioCypher stays REGISTERED. No DB pool.',
  },
  {
    id: 'evidence-integrator', cat: 'sources',
    body:
      'Evidence integrator (FAERS/ClinVar/ChEMBL) live ingest. produces: []; consumes: []. Live network fetch —' +
      ' not stateless. gate: 0; return skippedContribution("live FAERS/ClinVar/ChEMBL lookup — run via Source' +
      ' Ingest"). Create ONE file lib/moa/agents/evidence-integrator.ts so this cluster stays REGISTERED. No I/O.',
  },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'file', 'produces', 'consumes', 'gateSummary', 'composition', 'usedClaude'],
  properties: {
    id: { type: 'string' },
    file: { type: 'string' },
    produces: { type: 'array', items: { type: 'string' } },
    consumes: { type: 'array', items: { type: 'string' } },
    gateSummary: { type: 'string' },
    composition: { type: 'string', description: 'what upstream artifacts run() reads and what it produces' },
    usedClaude: { type: 'boolean' },
    extraFiles: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

phase('Agents')
const built = (await parallel(
  AGENTS.map((a) => () =>
    agent(
      [
        'Write the PaperTrail v2 COMPOSING MoA agent for: ' + a.id + ' (category hint: ' + a.cat + ').',
        '',
        CONTRACT,
        '',
        'YOUR AGENT:',
        a.body,
        '',
        'Create lib/moa/agents/' + a.id + '.ts (default-export the MoaAgent). Ship complete, typed, strict code —',
        'no any, no TODOs. Do NOT run npm/tsc. Return your file + exact produces/consumes + the composition wiring.',
      ].join('\n'),
      { label: 'agent:' + a.id, phase: 'Agents', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review the PaperTrail v2 COMPOSING MoA agents. READ lib/moa/types.ts, blackboard.ts,',
    'scheduler.ts, then EVERY file under lib/moa/agents/. Verify REAL COMPOSITION and build safety:',
    '  1. Each agents produces[]/consumes[] EXACTLY matches what run() writes (produced map) and reads',
    '     (bb.get calls). A declared consume with no bb.get, or a bb.get with no declared consume, is a bug.',
    '  2. The key composition edges exist and are wired: minicheck PRODUCES source_labels; multivers, valsci,',
    '     storm CONSUME source_labels via bb.get; quant-extractor PRODUCES effect_sizes; pymare + iterative',
    '     CONSUME effect_sizes; valsci PRODUCES contested; storm CONSUMES contested; paperqa PRODUCES quality;',
    '     minicheck CONSUMES quality+relevance; loki PRODUCES relevance. A consumer that ignores its upstream',
    '     artifact (recomputes instead of reading bb) is a FAILURE of composition — flag it.',
    '  3. Produced payloads match the types in types.ts (SourceLabel/ParsedEffectSize/etc.) field-for-field.',
    '  4. gate() is pure/deterministic [0,1] and reads ONLY ctx (never bb). run() never throws for missing',
    '     input (skippedContribution) and wraps work in try/catch (erroredContribution). No DB pool / no',
    '     disallowed network. usedClaude truthful. groundedSpans only verbatim engine-grounded quotes.',
    '  5. TypeScript build risk: bad import paths/names, wrong signatures, any-usage, missing default export,',
    '     payload shape mismatches. Report concrete issues with file + fix.',
  ].join('\n'),
  { label: 'verify:agents', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('MoA v2 agents: ' + built.length + ' composed; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }

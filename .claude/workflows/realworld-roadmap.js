export const meta = {
  name: 'papertrail-realworld-roadmap',
  description: 'Analyze each OSS engine + product surface and synthesize a real-world product roadmap',
  phases: [
    { title: 'Analyze', detail: 'per-cluster deep analysis of OSS engines + product surface' },
    { title: 'Synthesize', detail: 'merge into a prioritized real-world roadmap' },
  ],
}

const FRAME = [
  'CONTEXT: PaperTrail is a provenance/evidence-verification platform (Next.js 16 + Postgres/Neon + Claude).',
  'It is live (https://papertrail-topaz-phi.vercel.app) at MVP maturity: verification works, 45-tool MCP',
  'connector into Claude Science works, deterministic biostatistics moat (no LLM in the numeric loop), exact-',
  'span grounding, 11 biomedical engines, an evidence-intelligence + enterprise-governance layer, and native',
  'TypeScript ports of 17 OSS projects (source retained under backend/engines/, ported into lib/).',
  '',
  'GOAL NOW: leave hackathon framing behind and plan a REAL-WORLD product. The owner wants more pages, more',
  'APIs, more functionality, more features, more backend — and to FULLY exploit and SPECIALIZE each OSS engine',
  'for PaperTrail (not generic library use: improvise the algorithm to serve provenance-grade evidence',
  'verification for regulated life-sciences / pharma). Think like a biomedical-PhD founder building a fundable,',
  'defensible company (comps: Causaly, Aetion, Open Targets — $100M+ outcomes).',
  '',
  'CRITICAL DIRECTIVE: we OWN the vendored OSS (permissive licenses). Specialization must include EDITING THE',
  'ENGINE SOURCE IN PLACE under backend/engines/<engine>/ — add PaperTrail-specific modules, adapters, prompts,',
  'grounding hooks, and provenance/audit instrumentation INSIDE each engine directory so the engine itself',
  'becomes PaperTrail-native (not a generic library, and not only a lib/ re-implementation). For every engine,',
  'propose concrete in-repo changes to backend/engines/<engine>/ AND how they wire into lib/ + app/api. We can',
  'bundle all engines together into one coherent PaperTrail evidence stack.',
  '',
  'ENGINE -> CURRENT NATIVE PORT (so you analyze the GAP, not what exists):',
  '  MiniCheck->lib/grounding/entailment.ts; multivers/Valsci->lib/scieval/*; OpenFactVerification(Loki)->',
  '  lib/factcheck/pipeline.ts; paper-qa->lib/paperqa/*+lib/retrieval/contextualRerank.ts; R2R->lib/retrieval/',
  '  hybrid.ts; storm->lib/synthesis/outline.ts+lib/synthesisReport/*; open_deep_research/gpt-researcher->',
  '  lib/research/orchestrator.ts; pyalex->lib/sources/openalex.ts; pytrials->lib/sources/clinicaltrials.ts;',
  '  indra->lib/mechanism/assemble.ts; biocypher->lib/kg/biolink.ts; pykeen->lib/kg/linkPredict.ts; scispacy->',
  '  lib/entities/ner.ts; asreview->lib/screening/activeLearning.ts; PyMARE->lib/metaAnalysis.ts+metaEstimators.ts.',
].join('\n')

const CLUSTERS = [
  {
    key: 'verification',
    title: 'Verification & entailment core (the moat)',
    read:
      'backend/engines/MiniCheck, backend/engines/multivers, backend/engines/OpenFactVerification,' +
      ' backend/engines/Valsci; lib/grounding.ts, lib/grounding/*, lib/scieval/*, lib/factcheck/*,' +
      ' lib/verify/*, lib/structuredVerification.ts, lib/effectSize.ts, lib/biostats.ts.',
  },
  {
    key: 'retrieval-research',
    title: 'Retrieval & agentic research',
    read:
      'backend/engines/paper-qa, backend/engines/R2R, backend/engines/storm,' +
      ' backend/engines/open_deep_research; lib/retrieval/*, lib/paperqa/*, lib/research/*,' +
      ' lib/deepResearch/*, lib/synthesisReport/*, lib/synthesis/*, lib/embeddings.ts.',
  },
  {
    key: 'sources',
    title: 'Sources, ingestion & living evidence',
    read:
      'backend/engines/pyalex, backend/engines/pytrials; lib/sources/*, lib/ingest/*, lib/ingestion/*,' +
      ' lib/alerts/*, lib/monitoring/*, lib/rwe/*, lib/db.ts, db/migrations (recent). Consider NEW open' +
      ' bio-data sources worth ingesting (Open Targets, ChEMBL, ClinVar, GWAS, PubTator, openFDA, Europe PMC).',
  },
  {
    key: 'bio-kg',
    title: 'Biomedical knowledge graph, mechanism & NLP',
    read:
      'backend/engines/indra, backend/engines/biocypher, backend/engines/pykeen, backend/engines/scispacy;' +
      ' lib/kg/*, lib/entities/*, lib/mechanism/*, lib/bio/*, lib/graph/*, lib/dossier/*.',
  },
  {
    key: 'systematic-review',
    title: 'Systematic review, screening & meta-analysis',
    read:
      'backend/engines/asreview, backend/engines/PyMARE; lib/screening/*, lib/metaAnalysis.ts,' +
      ' lib/metaEstimators.ts, lib/prisma/*, lib/riskOfBias.ts, lib/grade.ts, lib/publicationBias.ts,' +
      ' lib/subgroupAnalysis.ts, lib/continuousMeta.ts, lib/networkMeta.ts, lib/doseResponse.ts,' +
      ' lib/survival.ts, lib/trialSequential.ts.',
  },
  {
    key: 'product-surface',
    title: 'Product surface, MCP/skills & go-to-market',
    read:
      'app/ (public pages) and app/console/* (the app), app/api/* (inventory the ~305 routes by domain),' +
      ' components/*, mcp/* (the connector + tools), skills/*. Identify the pages/APIs/features a REAL product' +
      ' needs that are missing (dashboards, collaboration, exports, billing/plans, admin, onboarding, API' +
      ' platform, integrations, audit), and how the MCP/skills surface should grow.',
  },
]

const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['cluster', 'currentState', 'untappedUpstream', 'proposals', 'topPick'],
  properties: {
    cluster: { type: 'string' },
    currentState: { type: 'string', description: 'what we have today in lib/app for this cluster, honestly' },
    untappedUpstream: {
      type: 'array',
      items: { type: 'object', additionalProperties: false,
        required: ['capability', 'engine', 'whyValuable'],
        properties: { capability: { type: 'string' }, engine: { type: 'string' }, whyValuable: { type: 'string' } } },
    },
    proposals: {
      type: 'array',
      items: { type: 'object', additionalProperties: false,
        required: ['title', 'description', 'engineLeverage', 'newPages', 'newApis', 'effort', 'impact'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string', description: 'concrete PaperTrail-specific feature, not generic' },
          engineLeverage: { type: 'string', description: 'which OSS engine capability it specializes/exploits' },
          newPages: { type: 'array', items: { type: 'string' } },
          newApis: { type: 'array', items: { type: 'string' } },
          effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          impact: { type: 'string', enum: ['low', 'medium', 'high'] },
        } },
    },
    topPick: { type: 'string', description: 'the single highest-leverage proposal for a real product' },
  },
}

phase('Analyze')
const analyses = (await parallel(
  CLUSTERS.map((c) => () =>
    agent(
      [
        'Deeply analyze ONE cluster of PaperTrail for a real-world product plan: ' + c.title + '.',
        '',
        FRAME,
        '',
        'READ (upstream OSS source + our native ports): ' + c.read,
        '',
        'Produce a GROUNDED analysis (cite files you actually read):',
        '1. currentState — what PaperTrail actually does here today, and its honest limitations.',
        '2. untappedUpstream — specific capabilities in the OSS engines that we have NOT ported/exploited yet,',
        '   and why each is valuable for provenance-grade evidence verification.',
        '3. proposals — concrete, PaperTrail-specific features that SPECIALIZE these engines for our domain',
        '   (regulated life-sciences evidence). For each: what it adds, which engine capability it leverages,',
        '   the new pages + new API routes it implies, and effort/impact. Favor things that deepen the moat',
        '   (deterministic, grounded, auditable) and that a pharma/biotech buyer would pay for.',
        '4. topPick — the single highest-leverage move in this cluster.',
        '',
        'Be specific and technical. No generic "add more tests" filler. Think biomedical-PhD founder.',
      ].join('\n'),
      { label: 'analyze:' + c.key, phase: 'Analyze', agentType: 'Explore', schema: ANALYSIS_SCHEMA }
    )
  )
)).filter(Boolean)

phase('Synthesize')
const roadmap = await agent(
  [
    'You are the founding architect. Synthesize the per-cluster analyses below into ONE prioritized real-world',
    'product roadmap for PaperTrail — post-hackathon, aimed at a fundable, defensible evidence-intelligence',
    'company for regulated life-sciences (comps: Causaly, Aetion, Open Targets).',
    '',
    FRAME,
    '',
    'CLUSTER ANALYSES (JSON):',
    JSON.stringify(analyses),
    '',
    'Produce a roadmap that: (a) sequences work into Now / Next / Later; (b) groups concrete deliverables by',
    'the owner\'s five axes — new PAGES, new APIS, new FEATURES, new BACKEND, and OSS-ENGINE DEEPENING (per',
    'engine: how to specialize it for PaperTrail); (c) names ONE flagship demo/wedge that proves the moat to a',
    'buyer; (d) flags the top risks. Be concrete: real route names, real page names, real module names. Prefer',
    'depth that compounds the deterministic + grounded + auditable moat over breadth that dilutes it.',
  ].join('\n'),
  { label: 'synthesize', phase: 'Synthesize', schema: {
    type: 'object', additionalProperties: false,
    required: ['thesis', 'nowNextLater', 'byAxis', 'flagship', 'risks'],
    properties: {
      thesis: { type: 'string' },
      nowNextLater: { type: 'object', additionalProperties: false,
        required: ['now', 'next', 'later'],
        properties: {
          now: { type: 'array', items: { type: 'string' } },
          next: { type: 'array', items: { type: 'string' } },
          later: { type: 'array', items: { type: 'string' } },
        } },
      byAxis: { type: 'object', additionalProperties: false,
        required: ['pages', 'apis', 'features', 'backend', 'ossDeepening'],
        properties: {
          pages: { type: 'array', items: { type: 'string' } },
          apis: { type: 'array', items: { type: 'string' } },
          features: { type: 'array', items: { type: 'string' } },
          backend: { type: 'array', items: { type: 'string' } },
          ossDeepening: { type: 'array', items: { type: 'string' } },
        } },
      flagship: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' } },
    },
  } }
)

log('Roadmap synthesized from ' + analyses.length + ' cluster analyses.')
return { analyses, roadmap }

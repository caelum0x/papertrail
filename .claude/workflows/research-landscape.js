export const meta = {
  name: 'research-landscape',
  description: 'Research PaperTrail\'s biggest commercial competitors + similar open-source projects via web search, write two inspiration docs, and return a clone list of permissive OSS repos to mine for pages/APIs/architecture/features.',
  whenToUse: 'To map the competitive + OSS landscape for feature/architecture inspiration and pick repos to clone into the codebase.',
  phases: [
    { title: 'Research', detail: 'parallel web-search agents across commercial + 3 OSS categories' },
    { title: 'Synthesize', detail: 'write docs/competitive-landscape.md + docs/oss-inspiration.md' },
    { title: 'Report', detail: 'return the clone list (repo, license, why)' },
  ],
}

const CONTEXT = `PaperTrail is a deterministic evidence-verification + literature-synthesis platform
for life sciences (Next.js 14 / TS / Postgres+pgvector / Anthropic Claude). It verifies clinical
efficacy claims against primary sources (PubMed / ClinicalTrials.gov), pools evidence
(meta-analysis, survival, network meta, GRADE, risk-of-bias), and produces a defensible citation
trail — with a deterministic engine as the trust layer and Claude for extraction/reasoning. Goal:
grow it into a FULL, feature-complete AI research platform where Claude does heavy work at scale.
Find what the best competitors + OSS projects have that we should borrow: PAGES, APIs,
ARCHITECTURE, FEATURES, FUNCTIONALITY.`

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['products'],
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'url', 'category', 'oneLiner', 'keyFeatures', 'borrowForUs'],
        properties: {
          name: { type: 'string' },
          url: { type: 'string' },
          repoUrl: { type: 'string', description: 'GitHub URL if open source, else empty' },
          license: { type: 'string', description: 'e.g. MIT/Apache-2.0/GPL/proprietary/unknown' },
          category: { type: 'string' },
          oneLiner: { type: 'string' },
          keyFeatures: { type: 'array', items: { type: 'string' } },
          pagesOrApis: { type: 'array', items: { type: 'string' }, description: 'notable pages/screens or API surfaces' },
          architectureNotes: { type: 'string' },
          borrowForUs: { type: 'string', description: 'concrete pages/apis/features/architecture PaperTrail should adopt' },
          cloneWorthy: { type: 'boolean', description: 'true if OSS + permissive-ish + worth cloning for reference' },
        },
      },
    },
  },
}

const RESEARCH = [
  {
    key: 'commercial',
    label: 'research:commercial-competitors',
    prompt: CONTEXT + `

RESEARCH the biggest COMMERCIAL competitors / adjacent products. Use web search. Cover, and go
beyond: Elicit, Consensus, Scite.ai, SciSpace, Undermind, ResearchRabbit, Causaly, BenchSci,
DistillerSR, Covidence, Rayyan, Silvi.ai, Iris.ai, Scholarcy, Dimensions, Semantic Scholar,
FutureHouse. For each meaningful one return: what it does, its standout FEATURES, notable
PAGES/screens and any public API, its architecture if known, and specifically what PaperTrail
should BORROW (features/pages/apis). Focus on evidence synthesis, claim verification, systematic
review, medical affairs, and AI research assistants. Return 10-15 products.`,
  },
  {
    key: 'litai',
    label: 'research:oss-literature-ai',
    prompt: CONTEXT + `

RESEARCH open-source LITERATURE-AI / RAG-for-science / research-agent projects. Use web search
and GitHub. Cover, and go beyond: PaperQA / paper-qa2 (FutureHouse), STORM (Stanford OVAL),
gpt-researcher, open-deep-research, txtai, Haystack, LlamaIndex research templates, scholarly
agents, OpenAlex/Semantic Scholar tooling, Aviary. For each return repoUrl, LICENSE, standout
FEATURES, its ARCHITECTURE (agent loop, retrieval, citation handling), notable APIs/modules, and
what PaperTrail should BORROW. Mark cloneWorthy=true for permissive (MIT/Apache/BSD), high-quality
repos worth cloning for reference. Return 8-12 projects.`,
  },
  {
    key: 'sysrev',
    label: 'research:oss-systematic-review',
    prompt: CONTEXT + `

RESEARCH open-source SYSTEMATIC-REVIEW, SCREENING, and META-ANALYSIS projects. Use web search and
GitHub. Cover, and go beyond: ASReview (active-learning screening), RobotReviewer, revtools,
Buhos, Colandr, metafor (R), PythonMeta, meta/metafor ecosystems, PRISMA tooling, PICO extractors.
For each return repoUrl, LICENSE, standout FEATURES, workflow/ARCHITECTURE, notable APIs/modules,
and what PaperTrail should BORROW (screening UX, active learning, PRISMA flow, meta-analysis
methods, data model). Mark cloneWorthy for permissive high-quality repos. Return 8-12 projects.`,
  },
  {
    key: 'verify',
    label: 'research:oss-claim-verification',
    prompt: CONTEXT + `

RESEARCH open-source CLAIM-VERIFICATION / fact-checking / scientific-grounding projects. Use web
search and GitHub. Cover, and go beyond: SciFact, MultiVerS, MiniCheck, Loki, Valsci, FEVER/
FEVEROUS, FactScore, RARR, Search-Augmented Factuality (SAFE), citation-verification tools. For
each return repoUrl, LICENSE, standout METHODS/FEATURES, ARCHITECTURE (entailment, retrieval,
decomposition), notable APIs/modules, and what PaperTrail should BORROW (verification methods,
eval datasets, decomposition strategies). Mark cloneWorthy for permissive repos. Return 8-12
projects.`,
  },
]

// PHASE 1 — RESEARCH (parallel web search)
phase('Research')
log('Fanning out web-search agents across commercial + OSS categories…')
const research = await parallel(
  RESEARCH.map((r) => () =>
    agent(r.prompt, { label: r.label, phase: 'Research', schema: FINDINGS_SCHEMA }).then((res) => ({ key: r.key, res }))
  )
)
const all = research.filter(Boolean)
const products = all.flatMap((r) => (r.res?.products || []).map((p) => ({ ...p, group: r.key })))
const cloneList = products.filter((p) => p.cloneWorthy && p.repoUrl)
log('Research: ' + products.length + ' products found, ' + cloneList.length + ' clone-worthy OSS repos.')

// PHASE 2 — SYNTHESIZE (write docs)
phase('Synthesize')
log('Writing docs/competitive-landscape.md and docs/oss-inspiration.md…')
const commercial = products.filter((p) => p.group === 'commercial')
const oss = products.filter((p) => p.group !== 'commercial')
const writer = await agent(
  CONTEXT + `

WRITE TWO markdown docs from the research JSON below. Be concrete and useful — this drives our
next build rounds. Do not invent products; use only what is provided.

1. docs/competitive-landscape.md — a table of commercial competitors (name, one-liner, standout
   features, notable pages/APIs), then a "What PaperTrail should borrow" section grouped by theme
   (features, pages/screens, APIs, architecture), then a prioritized FEATURE BACKLOG for PaperTrail
   (bulleted, each item tagged as [page]/[api]/[feature]/[architecture]).

2. docs/oss-inspiration.md — a table of the open-source projects (name, repoUrl, license,
   standout features, architecture notes, what to borrow), a "Clone list" section listing the
   cloneWorthy repos with their repoUrl + license + one line on why, and an "Architecture/patterns
   to adopt" section.

COMMERCIAL JSON:
` + JSON.stringify(commercial).slice(0, 12000) + `

OSS JSON:
` + JSON.stringify(oss).slice(0, 16000) + `

Create both files with the Write tool. Report the two paths you wrote.`,
  { label: 'synthesize:docs', phase: 'Synthesize', effort: 'high' }
)

// PHASE 3 — REPORT
phase('Report')
return {
  totalProducts: products.length,
  commercialCount: commercial.length,
  ossCount: oss.length,
  cloneList: cloneList.map((p) => ({ name: p.name, repoUrl: p.repoUrl, license: p.license, why: p.borrowForUs })),
  docsWritten: writer,
}

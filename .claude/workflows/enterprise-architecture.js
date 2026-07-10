export const meta = {
  name: 'papertrail-enterprise-architecture',
  description: 'Architect agents produce architecture diagrams + enterprise plan + biology-domain plan',
  phases: [
    { title: 'Architect', detail: 'system, enterprise/security, biology-domain — in parallel' },
  ],
}

const FRAME = [
  'CONTEXT: PaperTrail — provenance-grade evidence-verification platform (Next.js 16 App Router, TypeScript,',
  'Postgres/pgvector on Neon, Claude, Voyage embeddings), deployed on Vercel; live at',
  'https://papertrail-topaz-phi.vercel.app. ~310 API routes, a large lib/ (verification, biostatistics,',
  'meta-analysis, bio engines, KG, dossier, governance), 17 vendored OSS engines under backend/engines/ we OWN,',
  'a local + hosted MCP connector (/api/mcp) into Anthropic Claude Science, and a Claude Science skills set.',
  '',
  'MOAT: deterministic biostatistics (no LLM in the numeric loop) + exact-span grounding + honest downgrade +',
  'owned/specializable OSS engines. Target: a fundable, defensible REGULATORY-GRADE evidence platform for',
  'life-sciences (comps Causaly/Aetion/Open Targets), used at scale by PhDs & researchers, ENTERPRISE-grade',
  'like Anthropic/Claude. See docs/roadmap-realworld.md for the product roadmap.',
  '',
  'DELIVERABLE STYLE: produce real Mermaid diagrams (graph TD / flowchart / C4-ish / sequence / ER as fit) and',
  'concise, decisive plans grounded in the ACTUAL codebase (read app/, app/api/, lib/, db/migrations,',
  'backend/engines/, mcp/). Name real routes, modules, tables. No vague filler.',
].join('\n')

const AREAS = [
  {
    key: 'system',
    title: 'System architecture & the evidence-verification spine',
    focus: [
      'Produce these diagrams (Mermaid): (1) C4 System Context — users (researcher, pharma medical-affairs,',
      'Claude Science) ↔ PaperTrail ↔ external data (PubMed, CT.gov, OpenFDA/FAERS, ClinVar, ChEMBL, Open',
      'Targets, OpenAlex, Anthropic, Voyage). (2) Container diagram — Next.js app (public site, console,',
      'app/api), Postgres/pgvector, the OSS engine layer (backend/engines), the MCP endpoints, background jobs/',
      'cron. (3) The EVIDENCE SPINE as a flowchart: ingest → canonicalize (entities) → retrieve/rerank → verify',
      '(entailment + deterministic biostats + grounding) → synthesize (meta-analysis/GRADE) → codify (PRISMA/SoF/',
      'provenance chain/export). (4) A verify-a-claim SEQUENCE diagram across lib modules. (5) Core data model ER',
      '(orgs, users, memberships, sources, verifications, document_entities, trial_analyses, evidence_reports,',
      'audit chain). Read the code to keep it accurate. Also give a short target-state module map.',
    ].join('\n'),
  },
  {
    key: 'enterprise',
    title: 'Enterprise infrastructure, security, scale & the edge/XDR gateway',
    focus: [
      'Plan + diagrams for an Anthropic/Claude-grade enterprise posture. Cover: (1) Deployment/scaling diagram —',
      'current Vercel + Neon, and the SCALE-OUT path (edge, regional read replicas, a queue/worker tier for heavy',
      'ingest + KG training, object storage for snapshots/exports, a vector store at scale). (2) An EDGE / API-',
      'GATEWAY + SECURITY layer: evaluate an Envoy-based gateway / "XDR"-style control plane (like Atlassian',
      'forking Envoy) as the front door for authN/Z, rate-limiting, WAF, tenant isolation, request provenance,',
      'audit logging, and threat detection — give a Mermaid diagram and a clear build-vs-buy recommendation',
      '(Envoy fork vs Vercel edge + existing lib/apiv1 gateway). (3) Compliance controls mapped to code:',
      'SOC 2, HIPAA, and 21 CFR Part 11 / GxP — tie each to lib/compliance/chain.ts, lib/governance/*,',
      'lib/audit.ts, RBAC (lib/authz/rbac.ts), the api_keys gateway (lib/apiv1/gateway.ts). (4) Multi-tenancy,',
      'SSO/SCIM, secrets, observability (SLO/SLA, tracing, error budgets). (5) Packaging/pricing tiers',
      '(researcher / team / pharma enterprise) and per-tier limits. Be decisive with recommendations.',
    ].join('\n'),
  },
  {
    key: 'biology',
    title: 'Biology domain knowledge & biology verification workflows',
    focus: [
      'PaperTrail needs deep BIOLOGY DOMAIN KNOWLEDGE and workflows — but in OUR lane: not redoing scanpy/',
      'phylogenetics (that is Claude Science), but ENCODING domain knowledge to GROUND and VERIFY the claims',
      'those analyses produce. Design: (1) a biomedical KNOWLEDGE LAYER — ontologies/vocabularies (HGNC, UniProt,',
      'ChEMBL, EFO/DOID, GO, UBERON, MeSH, UMLS), cell-type marker panels, gene/variant/drug canonicalization,',
      'signature libraries — as data + services (name tables + lib modules; extend lib/entities, lib/kg,',
      'lib/bio). (2) A "verify a bioinformatics finding" workflow: e.g., take a Claude Science output like',
      '"CD8 memory/exhausted ratio stratifies ICB responders (AUC 0.86)" or "signature genes IL7R/TCF7/CCR7" and',
      'verify each claim + marker + effect size against primary literature with grounded spans + provenance,',
      'flagging overstatement/population mismatch. Give a Mermaid flow. (3) A set of BIOLOGY SKILLS for Claude',
      'Science (skills/) + MCP tools that expose this domain verification. (4) Domain-specific deterministic',
      'rules (e.g., variant-outcome mismatch vs ClinVar; marker-gene canonicalization; dose-response sanity).',
      'Give concrete new pages/APIs/skills/modules. Read lib/bio, lib/entities, lib/kg, lib/mechanism, mcp/, skills/.',
    ].join('\n'),
  },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['area', 'diagrams', 'plan', 'keyDecisions'],
  properties: {
    area: { type: 'string' },
    diagrams: {
      type: 'array',
      items: { type: 'object', additionalProperties: false,
        required: ['title', 'mermaid', 'caption'],
        properties: { title: { type: 'string' }, mermaid: { type: 'string', description: 'valid Mermaid diagram source' }, caption: { type: 'string' } } },
    },
    plan: {
      type: 'array',
      items: { type: 'object', additionalProperties: false,
        required: ['item', 'detail'],
        properties: { item: { type: 'string' }, detail: { type: 'string' } } },
    },
    keyDecisions: { type: 'array', items: { type: 'string' } },
  },
}

phase('Architect')
const results = (await parallel(
  AREAS.map((a) => () =>
    agent(
      [
        'You are a principal software architect. Deliver the architecture for ONE area of PaperTrail: ' + a.title + '.',
        '',
        FRAME,
        '',
        a.focus,
        '',
        'Return diagrams (valid Mermaid source), a concise decisive plan, and the key architectural decisions',
        '(with recommendations, not just options). Ground everything in files you actually read.',
      ].join('\n'),
      { label: 'arch:' + a.key, phase: 'Architect', agentType: 'architect', schema: SCHEMA }
    )
  )
)).filter(Boolean)

log('Architecture produced for ' + results.length + ' areas.')
return { results }

export const meta = {
  name: 'build-biology-domain-layer',
  description: 'Phase 1: ontology + marker ground truth + bioinformatics-finding verifier + rules + scispaCy specialization + skills/MCP/UI',
  phases: [
    { title: 'Build', detail: 'schema, canonicalization, verifier, engine, surface — parallel disjoint files' },
    { title: 'Verify', detail: 'adversarial review' },
  ],
}

const CONTRACT = [
  'PAPERTRAIL BIOLOGY DOMAIN LAYER — shared contract. See docs/ARCHITECTURE-ENTERPRISE.md section 3.',
  '',
  'MOAT RULES (non-negotiable): NO LLM in entity linking or in the verdict/numeric path. Claude is only for',
  'NER (existing lib/entities/ner.ts) and optional prose summaries. Every quoted number/span must be grounded',
  'to a verbatim substring of the provided source text via locateSpan (lib/grounding.ts) — drop + count any',
  'that cannot be located. Reuse the proven Signal vocabulary + combine precedence from',
  'lib/bio/verifyBiomedicalClaim.ts (READ it first).',
  '',
  'STACK: Next.js 16 App Router, TS strict, Postgres/Neon (import getPool from @/lib/db, parameterized $1 SQL).',
  'The new bio routes are PUBLIC compute like the existing app/api/bio/* — READ app/api/bio/genetic-association/',
  'route.ts for the exact pattern: export const runtime = "nodejs"; IP checkRateLimit (lib/rateLimit); zod',
  'safeParse; ok/fail envelope from lib/api/response; try/catch; never log the raw text. The ontology tables are',
  'PUBLIC (no org_id), following the bio_cache (0051) + kg_nodes (0052) precedent.',
  '',
  'SCHEMA CONTRACT (migration 0062_bio-ontology.sql, idempotent create-if-not-exists):',
  '  ontology_terms(curie text primary key, ontology text not null, label text not null, term_type text,',
  '    obsolete boolean not null default false, replaced_by text)',
  '  ontology_synonyms(curie text not null references ontology_terms(curie) on delete cascade, synonym_norm text',
  '    not null, source text)  -- index on lower(synonym_norm)',
  '  ontology_xrefs(curie text not null references ontology_terms(curie) on delete cascade, xref_curie text not null)',
  '  ontology_edges(subject_curie text not null, predicate text not null, object_curie text not null)',
  '  cell_marker_panels(id uuid pk default gen_random_uuid(), cell_type_curie text, cell_type_label text,',
  '    gene_curie text, gene_symbol text, direction text, tissue_curie text, source text, pmid text)',
  '  gene_signatures(signature_id text primary key, name text, source text, gene_symbols text[], provenance text)',
  '  Indexes: ontology_synonyms lower(synonym_norm); cell_marker_panels(cell_type_curie), (gene_symbol).',
  '',
  'CANONICALIZER CONTRACT (lib/entities/canonicalize.ts):',
  '  export interface CanonicalEntity { curie: string; canonicalLabel: string; ontology: string; termType: string |',
  '    null; score: number; xrefs: string[] }',
  '  export async function resolveEntity(pool: Pool, surface: string, type?: string): Promise<CanonicalEntity | null>',
  '  Deterministic: normalize the surface (lowercase, collapse whitespace), exact match against',
  '  ontology_synonyms.synonym_norm -> score 1.0; if type given, filter ontology_terms.term_type; return null when',
  '  nothing matches (honest miss). No LLM. Also export resolveMany(pool, surfaces, type?).',
].join('\n')

const GROUPS = [
  {
    key: 'schema',
    body:
      'Create the ontology schema + a CURATED starter seed (we cannot download multi-GB sources; ship a solid,' +
      ' honest curated set and log coverage). Files: (1) db/migrations/0062_bio-ontology.sql per the schema' +
      ' contract. (2) lib/bio/ontologyData.ts — exported typed constants: a curated set of ontology_terms +' +
      ' synonyms + xrefs covering the common genes (HGNC: IL7R, TCF7, CCR7, SELL, LEF1, FOXP3, PDCD1, HAVCR2,' +
      ' LAG3, TIGIT, TOX, MKI67, NKG7, CD14, MS4A1, TNF, JAK2, etc.), a few diseases (EFO/MONDO: melanoma,' +
      ' rheumatoid arthritis), and drugs (ChEMBL); cell_marker_panels for canonical immune populations (CD8' +
      ' memory-like, CD8 exhausted/dysfunctional, Treg, B cell, NK, Macrophage/Mono, pDC) with direction +' +
      ' source (CellMarker2.0/PanglaoDB) + pmid; and a couple of gene_signatures (e.g. ICB responder memory' +
      ' signature). (3) scripts/ingest-ontology.ts — reads ontologyData.ts and upserts all rows idempotently' +
      ' (on conflict do nothing/update), printing coverage counts; cache-once (no live fetch). Add an' +
      ' "ingest:ontology" script to package.json.',
  },
  {
    key: 'canonicalize',
    body:
      'Build the DB-backed deterministic canonicalizer. Files: (1) lib/bio/ontology.ts — query helpers over the' +
      ' 0062 tables: getTerm(pool, curie), getXrefs(pool, curie), isSubclassOf(pool, a, b) via ontology_edges,' +
      ' getMarkersForCellType(pool, cellTypeCurieOrLabel), getSignature(pool, signatureId). (2)' +
      ' lib/entities/canonicalize.ts per the CANONICALIZER CONTRACT (resolveEntity + resolveMany). (3)' +
      ' app/api/entities/canonicalize/route.ts — PUBLIC route (rate-limited) POST { surface | surfaces[], type? }' +
      ' -> ok(CanonicalEntity | list). READ app/api/bio/genetic-association/route.ts for the exact route shape.' +
      ' No LLM. Explicit types.',
  },
  {
    key: 'verifier',
    body:
      'Build the bioinformatics-finding verifier + 4 deterministic rule engines. READ lib/bio/verifyBiomedicalClaim.ts' +
      ' first and REUSE its Signal type + combine precedence. Files: (1) lib/bio/rules/markerCanonicalization.ts —' +
      ' given claimed markerGenes + cellType, resolve genes to canonical symbols and check membership + direction' +
      ' in cell_marker_panels (getMarkersForCellType); Signal per gene (positive if canonical marker, overstated/' +
      ' negative if wrong direction or not a marker). (2) lib/bio/rules/variantOutcomeConsistency.ts — reuse the' +
      ' existing ClinVar path (lib/bio/variantPathogenicity.ts) and flag a claimed protective/risk direction that' +
      ' contradicts the registered significance. (3) lib/bio/rules/doseResponseSanity.ts — monotonicity + potency-' +
      ' vs-phase plausibility (reuse lib/bio/chembl.ts patterns). (4) lib/bio/rules/effectSizeSanity.ts — pure:' +
      ' AUC in [0.5,1], CI contains the point estimate, HR/logFC direction vs claimed benefit. (5)' +
      ' lib/bio/verifyBioinformaticsFinding.ts — sibling of verifyBiomedicalClaim.ts: input { assertion,' +
      ' markerGenes[], cellType, effectSize { metric: AUC|HR|logFC, value, ci_lower?, ci_upper? }, population,' +
      ' sourceText }; ground the effect-size number verbatim in sourceText via locateSpan (drop + count if not' +
      ' found); run the rule engines + reuse validateBiomarker/verifyPathogenicityClaim where relevant; PURE' +
      ' combineFindingVerdict -> { verdict: supported|overstated|partially_supported|unsupported|insufficient_evidence,' +
      ' signals[], flagged_spans[], canonicalizedMarkers[], droppedUngrounded }. Injectable deps for offline test.' +
      ' (6) app/api/bio/verify-finding/route.ts, app/api/bio/marker-check/route.ts (POST { markerGenes[], cellType }),' +
      ' app/api/bio/variant-outcome/route.ts — PUBLIC rate-limited routes, zod-validated, ok/fail. Never log text.',
  },
  {
    key: 'engine',
    body:
      'Specialize the scispaCy engine IN PLACE for PaperTrail (we own it). Files under backend/engines/scispacy/:' +
      ' (1) papertrail_linker.py — a PaperTrail-native entity linker: given text (or pre-extracted mentions),' +
      ' resolve each to canonical ontology ids across HGNC/UniProt/ChEMBL/EFO/DOID/GO in PARALLEL, PRESERVING' +
      ' character offsets (start/end) for every mention so spans stay groundable, and attach provenance' +
      ' (ontology + match_type exact|abbrev|fuzzy + score). Pure-Python, standalone (argparse: reads text on' +
      ' stdin or --text, prints JSON to stdout with {mentions:[{text,start,end,curie,ontology,match_type,score}]}).' +
      ' Mirror the deterministic contract of lib/entities/ner.ts (Schwartz-Hearst abbreviation resolution,' +
      ' offset preservation). (2) backend/engines/scispacy/PAPERTRAIL.md — document that this file is a' +
      ' PaperTrail-native specialization, how it maps to lib/entities/canonicalize.ts, and how to invoke it.' +
      ' Do NOT edit any other engine. This dir is excluded from the Next build, so no TS impact.',
  },
  {
    key: 'surface',
    body:
      'Build the Claude Science surface + console UI. Files: (1) three skills folders under skills/:' +
      ' papertrail-verify-bioinformatics-finding, papertrail-marker-check, papertrail-canonicalize-entity —' +
      ' each skills/<name>/SKILL.md with YAML frontmatter (name == folder; description = what+when) and a body' +
      ' naming the MCP tool + a curl fallback to the live API; READ an existing skills/*/SKILL.md for the exact' +
      ' format. (2) mcp/src/tools/bioDomain.ts — export const bioDomainTools: PaperTrailTool[] with' +
      ' verify_bioinformatics_finding (POST /api/bio/verify-finding), check_marker_panel (POST /api/bio/marker-check),' +
      ' canonicalize_entity (POST /api/entities/canonicalize), verify_variant_outcome (POST /api/bio/variant-outcome);' +
      ' READ mcp/src/tools/biomedicalExtra.ts for the exact tool()/import pattern (import from ../client.js,' +
      ' ../registry.js with .js extensions). (3) APPEND the same 4 tools to lib/mcp/catalog.ts MCP_TOOLS (JSON-Schema' +
      ' inputSchema, correct paths) — READ that file first and match its McpToolDef shape exactly; do not remove' +
      ' existing entries. (4) app/console/bio/finding/page.tsx + _components/* — paste a finding, call' +
      ' /api/bio/verify-finding, render per-check verdict cards + highlight the grounded effect-size span; copy the' +
      ' x-org-id-free public-fetch style (these are public routes, no auth header needed). (5) app/console/ontology/' +
      ' page.tsx — resolve a symbol via /api/entities/canonicalize and show CURIE + xrefs + marker memberships.' +
      ' Theme tokens (bg-paper/text-ink/text-accent/border-ink/15). Do NOT edit mcp/src/server.ts or layout.tsx' +
      ' (the orchestrator wires those).',
  },
]

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['group', 'filesCreated'],
  properties: {
    group: { type: 'string' },
    filesCreated: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    followups: { type: 'array', items: { type: 'string' } },
  },
}

phase('Build')
const built = (await parallel(
  GROUPS.map((g) => () =>
    agent(
      [
        'Build ONE part of the PaperTrail biology domain layer: ' + g.key + '.',
        '',
        CONTRACT,
        '',
        'YOUR PART:',
        g.body,
        '',
        'Ship complete, working, typed code (no TODOs). Do NOT run npm/tsc. Create ONLY your files; do not edit',
        'files owned by other parts (server.ts, layout.tsx are the orchestrator\'s). Return the files you created.',
      ].join('\n'),
      { label: 'build:' + g.key, phase: 'Build', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review the PaperTrail biology domain layer just built. READ: db/migrations/0062_bio-ontology.sql,',
    'lib/bio/ontologyData.ts, scripts/ingest-ontology.ts, lib/bio/ontology.ts, lib/entities/canonicalize.ts,',
    'lib/bio/verifyBioinformaticsFinding.ts, lib/bio/rules/*.ts, app/api/bio/verify-finding|marker-check|variant-outcome,',
    'app/api/entities/canonicalize, mcp/src/tools/bioDomain.ts, lib/mcp/catalog.ts, skills/papertrail-*, and the',
    'app/console/bio + ontology pages. Check: NO LLM in linking/verdict/numeric paths; effect-size numbers grounded',
    'via locateSpan with ungroundable dropped+counted; Signal reuse from verifyBiomedicalClaim.ts; migration',
    'idempotent + FKs correct; routes rate-limited + zod-validated + never log text; canonicalize deterministic;',
    'mcp bioDomain.ts imports match registry.ts; catalog.ts additions valid JSON-Schema with correct paths;',
    'obvious TypeScript build risks. Report concrete issues with file + fix.',
  ].join('\n'),
  { label: 'verify:biology', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('Biology layer built: ' + built.length + ' parts; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }

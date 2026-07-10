export const meta = {
  name: 'build-multisource-ingest',
  description: 'Phase 2: multi-DB ingest pipeline + provenance + ingest-time entity canonicalization + FAERS/ClinVar/ChEMBL engine bridges',
  phases: [
    { title: 'Build', detail: 'schema, pipeline+drivers, entity-canon, engine bridges, api+ui — parallel' },
    { title: 'Verify', detail: 'adversarial review' },
  ],
}

const CONTRACT = [
  'PAPERTRAIL MULTI-SOURCE INGEST (Phase 2). See docs/roadmap-realworld.md ("Now"). This turns PaperTrail from a',
  'literature verifier into an EVIDENCE INTEGRATOR: pull from PubMed + CT.gov + OpenFDA/FAERS + ClinVar + ChEMBL',
  '+ Open Targets + PubTator into the shared sources cache, with per-source PROVENANCE (version + snapshot +',
  'access log) and INGEST-TIME entity canonicalization (canonical CURIEs persisted per document).',
  '',
  'MOAT RULES: cache-everything (CLAUDE.md — never live-fetch on a path a cached row can serve; never depend on',
  'live latency in the demo). Deterministic where numbers are involved. Entity linking is the deterministic',
  'ontology canonicalizer from Phase 1 (lib/entities/canonicalize.ts resolveEntity/resolveMany) + NER',
  '(lib/entities/ner.ts, Claude only for NER). Never log raw source/claim text — only ids/counts.',
  '',
  'READ FIRST to match conventions: lib/ingest/searchAndCache.ts (how sources are inserted/cached + the sources',
  'columns it writes), lib/db.ts, db/migrations/0001_foundation.sql (the sources table shape), lib/entities/ner.ts',
  '+ lib/entities/canonicalize.ts (Phase 1), the bio query engines lib/bio/{chembl,pharmacovigilance,',
  'variantPathogenicity,openTargets,pubtator}.ts, lib/sources/*, and app/api/bio/genetic-association/route.ts',
  '(public route pattern: runtime nodejs, IP checkRateLimit, zod safeParse, ok/fail envelope, try/catch).',
  '',
  'SHARED CONTRACTS (code against these so parallel parts compose):',
  '  lib/ingest/multiSourcePipeline.ts exports:',
  '    export interface IngestInput { query?: string; entity?: { surface?: string; curie?: string; type?: string };',
  '      sources?: string[]; limit?: number }',
  '    export interface SourceIngestResult { source_type: string; external_id: string; cached: boolean;',
  '      entitiesLinked: number }',
  '    export async function runMultiSourceIngest(pool: Pool, input: IngestInput):',
  '      Promise<{ ingested: SourceIngestResult[]; coverage: Record<string, number>; droppedUngrounded: number }>',
  '  lib/ingest/entityCanonicalization.ts exports:',
  '    export interface DocumentEntity { curie: string; surface: string; ontology: string; startOffset: number |',
  '      null; endOffset: number | null; matchType: string; score: number }',
  '    export async function canonicalizeSourceEntities(pool: Pool, sourceId: string, text: string):',
  '      Promise<{ entities: DocumentEntity[]; dropped: number }>  // NER -> resolveMany -> persist to document_entities',
  '',
  'STACK: Next.js 16, TS strict, Postgres/Neon getPool from @/lib/db, parameterized $1 SQL, additive migrations',
  '(create-if-not-exists / add-column-if-not-exists). Do NOT rewrite searchAndCache.ts — the pipeline is an',
  'ADDITIVE orchestrator that reuses its cache helpers where possible.',
].join('\n')

const GROUPS = [
  {
    key: 'schema',
    body:
      'Migration 0063_multi-source-ingest.sql (idempotent). (1) ALTER TABLE sources ADD COLUMN IF NOT EXISTS:' +
      ' variant_id text, compound_id text, adverse_event_cui text, source_version text, source_snapshot_id text,' +
      ' snapshot_date timestamptz. (2) CREATE TABLE IF NOT EXISTS document_entities (id uuid pk default' +
      ' gen_random_uuid(), source_id uuid not null references sources(id) on delete cascade, curie text not null,' +
      ' surface text, ontology text, start_offset int, end_offset int, match_type text, score numeric,' +
      ' created_at timestamptz not null default now()); indexes on (source_id), (curie). (3) CREATE TABLE IF NOT' +
      ' EXISTS source_access_log (id uuid pk, source_type text, external_id text, accessed_at timestamptz default' +
      ' now(), license text, snapshot_id text) for provenance/recordAccess. Confirm the sources table exists (do' +
      ' not recreate it) by reading its migration first. Add nothing org-scoped — sources are the existing shape.',
  },
  {
    key: 'pipeline',
    body:
      'lib/ingest/multiSourcePipeline.ts (per the SHARED CONTRACT) + lib/ingest/drivers/*.ts + lib/ingest/provenance.ts.' +
      ' provenance.ts: recordAccess(pool, {source_type, external_id, license?, snapshotId?}) inserts a' +
      ' source_access_log row + stamps source_version/snapshot_date on the sources row; a deterministic snapshot id' +
      ' (hash of source_type+external_id+date-less content) — do NOT use Date.now for the hash, derive from content.' +
      ' drivers/{faers,clinvar,chembl,openTargets,pubtator}.ts: each wraps the EXISTING lib/bio/* query engine and' +
      ' maps its result into a cacheable source record { source_type, external_id, title, raw_text, url, metadata }' +
      ' — cache-once (check the sources cache before fetching, reuse searchAndCache helpers). runMultiSourceIngest' +
      ' orchestrates: pick relevant drivers from input.sources (default: all) + the entity/query, fetch+cache each,' +
      ' call canonicalizeSourceEntities on each new source text, and return coverage counts per source_type. Never' +
      ' re-fetch a cached (source_type, external_id).',
  },
  {
    key: 'entity-canon',
    body:
      'lib/ingest/entityCanonicalization.ts (per the SHARED CONTRACT) + app/api/sources/by-entity/route.ts +' +
      ' app/api/entities/[curie]/sources/route.ts (or a query-param variant). canonicalizeSourceEntities: run' +
      ' extractEntities (lib/entities/ner.ts) on the text to get surface mentions with offsets, resolveMany' +
      ' (lib/entities/canonicalize.ts) to canonical CURIEs, DROP mentions that do not resolve (count them), and' +
      ' upsert the survivors into document_entities (source_id, curie, surface, ontology, offsets, match_type,' +
      ' score). No LLM in the linking step (NER is the only Claude call; reuse the existing ner cost controls).' +
      ' The by-entity route: GET ?curie=... returns the cached sources tagged with that canonical entity (join' +
      ' document_entities -> sources), public + rate-limited, ok/fail envelope.',
  },
  {
    key: 'engine-bridges',
    body:
      'Create three PaperTrail-native ingest engine bridges IN backend/engines/ (we own the stack; these are new' +
      ' PaperTrail engines): backend/engines/faers/run.py, backend/engines/clinvar/run.py, backend/engines/chembl/' +
      ' run.py + a PAPERTRAIL.md in each. Each is standalone stdlib-only Python (argparse; reads a query/entity on' +
      ' --arg or stdin; prints normalized JSON records to stdout: {records:[{external_id, title, raw_text, url,' +
      ' metadata, license, snapshot_id}]}) that fetches from the public API (OpenFDA FAERS / NCBI ClinVar E-utils /' +
      ' ChEMBL REST), normalizes to the cacheable source shape the TS drivers expect, and is cache-once friendly' +
      ' (deterministic snapshot_id derived from content, offset-preserving where it extracts text). Document in' +
      ' PAPERTRAIL.md that these are PaperTrail-native ingest bridges and how lib/ingest/drivers/*.ts consume them.' +
      ' This dir is excluded from the Next build (no TS impact). Do NOT edit the 17 existing OSS engines.',
  },
  {
    key: 'api-ui',
    body:
      'app/api/ingest/multi-source/route.ts (POST { query?, entity?, sources?, limit? } -> runMultiSourceIngest ->' +
      ' ok({ ingested, coverage, droppedUngrounded }); public, rate-limited, maxDuration 60, never log text) +' +
      ' app/api/sources/quality-report/route.ts (GET -> per-source_type counts + entity-coverage stats from' +
      ' sources + document_entities). Console: app/console/sources/ingest/page.tsx + _components/* — a control to' +
      ' run a multi-source ingest for a query/entity and show the coverage result + linked-entity counts, and a' +
      ' quality-report panel. Public-fetch style (these are public routes). Theme tokens bg-paper/text-ink/' +
      ' text-accent/border-ink/15. Do NOT edit layout.tsx (orchestrator wires nav). READ an existing console page' +
      ' (app/console/hypotheses/page.tsx) for the client pattern.',
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
        'Build ONE part of PaperTrail Phase 2 (multi-source ingest): ' + g.key + '.',
        '',
        CONTRACT,
        '',
        'YOUR PART:',
        g.body,
        '',
        'Ship complete, working, typed code (no TODOs, no any). Do NOT run npm/tsc. Create ONLY your files; do',
        'not edit files owned by other parts, searchAndCache.ts, server.ts, or layout.tsx. Return files created.',
      ].join('\n'),
      { label: 'build:' + g.key, phase: 'Build', schema: SCHEMA }
    )
  )
)).filter(Boolean)

phase('Verify')
const review = await agent(
  [
    'Adversarially review PaperTrail Phase 2 (multi-source ingest). READ db/migrations/0063_multi-source-ingest.sql,',
    'lib/ingest/multiSourcePipeline.ts, lib/ingest/drivers/*.ts, lib/ingest/provenance.ts,',
    'lib/ingest/entityCanonicalization.ts, app/api/ingest/multi-source, app/api/sources/by-entity,',
    'app/api/sources/quality-report, app/console/sources/ingest, and backend/engines/{faers,clinvar,chembl}/run.py.',
    'Check: migration idempotent + FK to sources correct; cache-once honored (no re-fetch of cached',
    '(source_type, external_id)); provenance recorded; entity canonicalization drops unresolved + persists to',
    'document_entities; NO LLM in linking/numeric paths; routes rate-limited + zod-validated + never log text;',
    'the shared contract signatures (runMultiSourceIngest, canonicalizeSourceEntities) match across files; no',
    'Date.now in any content hash; obvious TypeScript build risks. Report concrete issues with file + fix.',
  ].join('\n'),
  { label: 'verify:ingest', phase: 'Verify', agentType: 'Explore', schema: {
    type: 'object', additionalProperties: false,
    required: ['issues'],
    properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['severity', 'file', 'problem', 'fix'],
      properties: { severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        file: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } } } } },
  } }
)

log('Phase 2 built: ' + built.length + ' parts; ' + (review.issues ? review.issues.length : 0) + ' issues flagged.')
return { built, review }

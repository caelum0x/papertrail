-- Document processing AT SCALE. Builds the real ingestion pipeline on top of the
-- documents module (0005): per-page chunking, async extraction jobs, and
-- candidate verifiable claims extracted from a document's text.
-- All tables are org-scoped (multi-tenant) and idempotent — safe to re-run.

-- Chunks are sub-page slices of a document's text. Chunking enables retrieval /
-- claim extraction over hundreds of pages without loading the whole document.
-- embedding is optional (nullable) — populated later when an embedding provider
-- is wired; stored as text (JSON-encoded vector) so this migration has no hard
-- dependency on the pgvector extension being present.
create table if not exists document_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  page_number integer not null,
  chunk_index integer not null,
  text text not null,
  embedding text,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists document_chunks_org_idx
  on document_chunks(org_id, created_at desc);
create index if not exists document_chunks_document_idx
  on document_chunks(document_id, chunk_index);

-- One row per extraction run over a document. Tracks status so the pipeline UI
-- can show progress and surface failures instead of hanging.
create table if not exists extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  engine text,
  pages integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists extraction_jobs_org_idx
  on extraction_jobs(org_id, created_at desc);
create index if not exists extraction_jobs_document_idx
  on extraction_jobs(document_id, created_at desc);
create index if not exists extraction_jobs_status_idx
  on extraction_jobs(org_id, status);

-- Candidate verifiable claims pulled out of a document by the LLM. Each is a
-- span of prose that asserts a checkable efficacy/quantitative finding; the user
-- can promote one into a tracked claim for verification.
create table if not exists document_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  page_number integer,
  text text not null,
  extracted_by text not null default 'llm'
    check (extracted_by in ('llm', 'manual')),
  status text not null default 'candidate'
    check (status in ('candidate', 'promoted', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists document_claims_org_idx
  on document_claims(org_id, created_at desc);
create index if not exists document_claims_document_idx
  on document_claims(document_id, created_at desc);
create index if not exists document_claims_status_idx
  on document_claims(org_id, status);

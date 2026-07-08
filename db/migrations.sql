-- PaperTrail schema. Run via `npm run db:migrate`.
create extension if not exists vector;

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('pubmed', 'clinicaltrials')),
  external_id text not null,
  title text,
  raw_text text not null,
  url text not null,
  embedding vector(1024),
  fetched_at timestamptz default now(),
  unique (source_type, external_id)
);

create index if not exists sources_embedding_idx
  on sources using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete cascade,
  effect_size text,
  population text,
  condition text,
  endpoint text,
  caveats jsonb default '[]'::jsonb,
  extracted_at timestamptz default now(),
  unique (source_id)
);

create table if not exists verifications (
  id uuid primary key default gen_random_uuid(),
  claim_text text not null,
  matched_source_id uuid references sources(id),
  discrepancy_type text check (
    discrepancy_type in (
      'accurate', 'magnitude_overstated', 'population_overgeneralized',
      'caveat_dropped', 'no_support_found'
    )
  ),
  trust_score int check (trust_score between 0 and 100),
  explanation text,
  flagged_spans jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- Batch runs: one row per /api/verify/batch request, linking the verifications it produced.
create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  claim_count int not null,
  status text not null default 'processing' check (status in ('processing', 'complete', 'failed')),
  created_at timestamptz default now(),
  completed_at timestamptz
);

alter table verifications
  add column if not exists batch_id uuid references batches(id) on delete set null;

create index if not exists verifications_created_at_idx on verifications(created_at desc);
create index if not exists verifications_batch_id_idx on verifications(batch_id);

-- Trial context surfaced from ClinicalTrials.gov's structured designModule (null for PubMed).
alter table sources add column if not exists phase text;
alter table sources add column if not exists enrollment_count int;

-- Registered statistical results (outcome analyses: paramValue, CI, p-value) from
-- ClinicalTrials.gov's structured resultsSection. Cached at ingestion so the deterministic
-- registry check runs off the verify hot path. Null for PubMed / trials with no posted results.
alter table sources add column if not exists registered_results jsonb;

-- Multi-source cross-verification: how the other retrieved sources relate to the best match,
-- and the ids of the corroborating/conflicting sources considered.
alter table verifications add column if not exists cross_source_agreement text;
alter table verifications add column if not exists corroborating_source_ids jsonb default '[]'::jsonb;

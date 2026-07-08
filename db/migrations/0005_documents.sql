-- Document / PDF library & ingestion. Multi-tenant, org-scoped.
-- Stores uploaded document metadata plus extracted plain text (storage_key is a
-- placeholder for real blob storage). Idempotent — safe to run repeatedly.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid,
  filename text not null,
  mime_type text not null default 'text/plain',
  size_bytes integer not null default 0,
  storage_key text,
  extracted_text text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'extracted', 'failed')),
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists documents_org_id_idx on documents(org_id, created_at desc);
create index if not exists documents_project_id_idx on documents(project_id);

create table if not exists document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  page_number integer not null,
  text text,
  created_at timestamptz not null default now(),
  unique (document_id, page_number)
);

create index if not exists document_pages_document_id_idx
  on document_pages(document_id, page_number);

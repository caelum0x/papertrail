-- Global search: trigram indexes to keep org-scoped ILIKE lookups across
-- claims, documents, evidence, and verifications fast. Indexes only — the
-- searched tables are created by earlier migrations. Idempotent: safe to run
-- repeatedly.

-- pg_trgm powers the trigram (gin_trgm_ops) indexes that make `column ilike
-- '%term%'` queries index-assisted instead of full scans.
create extension if not exists pg_trgm;

-- Claims: match against the claim text, scoped to the org.
create index if not exists claims_text_trgm_idx
  on claims using gin (text gin_trgm_ops);

-- Documents: match against filename and extracted body text.
create index if not exists documents_filename_trgm_idx
  on documents using gin (filename gin_trgm_ops);
create index if not exists documents_extracted_text_trgm_idx
  on documents using gin (extracted_text gin_trgm_ops);

-- Evidence items: match against the curated title.
create index if not exists evidence_items_title_trgm_idx
  on evidence_items using gin (title gin_trgm_ops);

-- Verifications: match against the verified claim text. Verifications are
-- org-scoped in search by joining through claims(claim_id -> claims.org_id),
-- so index claim_id to keep that join cheap.
create index if not exists verifications_claim_text_trgm_idx
  on verifications using gin (claim_text gin_trgm_ops);

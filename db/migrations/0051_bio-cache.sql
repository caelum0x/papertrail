-- Bio-evidence response cache.
--
-- The lib/bio/* engines (Open Targets, FAERS/openFDA, ChEMBL, GWAS Catalog,
-- ClinVar, PharmGKB, PubTator) each call an external open bio-data API on every
-- request. Per the project's "cache everything fetched, never re-fetch" rule
-- (CLAUDE.md) this table memoizes the normalized JSON payload keyed by
-- (source, cache_key), so a repeated lookup is served from Postgres instead of
-- re-hitting a rate-limited public API. Deterministic engines produce the same
-- output for the same inputs, so caching is safe; a TTL bounds staleness.
--
-- Not org-scoped: bio-database facts are public reference data, shared across all
-- tenants (unlike the `sources` table which stores retrieved primary-source text).

create table if not exists bio_cache (
  source      text        not null,           -- 'open_targets' | 'faers' | 'chembl' | 'gwas' | 'clinvar' | 'pharmgkb' | 'pubtator'
  cache_key   text        not null,           -- normalized request key (e.g. 'PCSK9|EFO_0001645')
  payload     jsonb       not null,           -- the normalized engine result
  fetched_at  timestamptz not null default now(),
  primary key (source, cache_key)
);

-- Sweep expired rows efficiently (a periodic job / the cron tick can prune by age).
create index if not exists bio_cache_fetched_at_idx on bio_cache (fetched_at);

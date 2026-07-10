-- Learned knowledge-graph embeddings (TransE-style) for link prediction.
--
-- The topology link-predictor (lib/kg/linkPredict.ts) ranks candidate links from
-- GRAPH STRUCTURE ALONE — no learned parameters. This table adds the complementary
-- LEARNED view: a deterministic TransE-style embedding trained over the kg_edges
-- triples, so a candidate (subject, predicate, object) can be scored by the classic
-- translational distance ||v_subject + v_predicate - v_object||. A small distance
-- means the triple FITS the geometry the training induced — a plausible novel link.
--
-- Two kinds of vector live here, distinguished by `kind`:
--   'entity'   — one row per kg_nodes.id (keyed by the node's uuid string)
--   'relation' — one row per predicate (keyed by the predicate string, e.g. 'targets')
-- `key` is the entity uuid or the predicate name; `vector` is the double[] embedding
-- of length `dim`. `trained_at` records when the row was last (re)written.
--
-- MOAT: the vectors are produced by a DETERMINISTIC trainer (fixed seed, fixed
-- hash-derived init, margin-ranking updates) — see backend/engines/pykeen/
-- papertrail_train.py and its TypeScript mirror trainKgEmbeddings() in
-- lib/kg/learnedLinkPredict.ts. There is NO LLM anywhere in these numbers; the same
-- edge list always yields the same embedding, and the same embedding always yields
-- the same ranking. The scorer never invents a value: absent embeddings yield an
-- honest "learned prediction unavailable" rather than a guessed link.
--
-- Idempotent — safe to run repeatedly. House style follows 0052_knowledge-graph.sql:
-- uuid pks via gen_random_uuid(), lower-case SQL, `create ... if not exists`.

create extension if not exists pgcrypto;

create table if not exists kg_embeddings (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('entity', 'relation')),
  key        text not null,                       -- entity uuid (as text) or predicate name
  vector     double precision[] not null,          -- the learned embedding, length = dim
  dim        int not null,
  trained_at timestamptz not null default now()
);

-- One embedding per (kind, key). The unique index is the upsert target so re-training
-- refreshes a vector in place rather than accumulating stale duplicates, and lookups
-- by (kind, key) are index-covered.
create unique index if not exists kg_embeddings_kind_key_uidx
  on kg_embeddings (kind, key);

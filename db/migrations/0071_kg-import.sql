-- Bring-your-own-KG import batches.
--
-- Records one row per bring-your-own knowledge-graph import (POST /api/kg/import): a
-- lab uploads its own nodes + edges, and lib/kg/byoKg.ts validates each edge's predicate
-- against the Biolink slot domain/range (via lib/kg/biolink.ts, ported from the vendored
-- BioCypher engine — see backend/engines/biocypher/PAPERTRAIL.md) before writing the
-- accepted nodes/edges into the shared kg_nodes / kg_edges tables (migration
-- 0052_knowledge-graph.sql). An ill-typed edge is REJECTED with a reason, never coerced.
--
-- This batch table is the AUDIT record for that import: how many nodes/edges were
-- imported and how many edges were rejected as ill-typed. Unlike kg_nodes/kg_edges
-- (public reference facts), a batch is ORG-SCOPED — it attributes the import to the org
-- that ran it. House style follows 0001_foundation.sql / 0070_data-governance.sql:
-- idempotent DDL, uuid pk via gen_random_uuid(), lower-case SQL, create ... if not
-- exists. Safe to run repeatedly.

create extension if not exists pgcrypto;

create table if not exists kg_import_batches (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  node_count     int,
  edge_count     int,
  rejected_count int,
  created_by     uuid,
  created_at     timestamptz default now()
);

-- The import history for an org is listed most-recent-first, so index on exactly that
-- (org_id, created_at desc) pair.
create index if not exists kg_import_batches_org_created_idx
  on kg_import_batches(org_id, created_at desc);

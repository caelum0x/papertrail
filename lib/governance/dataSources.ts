import type { Pool } from "pg";
import {
  type CatalogEntry,
  type DataSource,
  type SourceAccess,
} from "@/lib/governance/dataSources.schemas";

// DATA-SOURCE PROVENANCE REGISTRY — data access + the documented static catalog.
//
// PaperTrail derives every evidence number from a small set of PUBLIC, open
// biomedical databases. A regulated buyer (medical-affairs / regulatory) must be
// able to answer, for any number in a report: which database did this come from,
// what version/snapshot, under what license, and when did we access it. This
// module is the single source of truth for that provenance metadata.
//
// The catalog below is REFERENCE FACT — license + canonical URL for each source
// PaperTrail integrates. `database_version` / `snapshot_date` default to null and
// are filled in operationally as fresh snapshots are ingested (upsertSource).
//
// Everything here is pure data access or a static constant. org_id is always the
// FIRST predicate on the access log; a client org_id is never trusted — callers
// pass the RESOLVED ctx.org.id. Parameterized SQL only.

// ---------------------------------------------------------------------------
// Static catalog — the platform's open data sources
// ---------------------------------------------------------------------------

// License/URL are the canonical, publicly documented facts for each source.
// Ordered roughly by how central each is to the evidence pipeline.
export const DATA_SOURCE_CATALOG: readonly CatalogEntry[] = [
  {
    sourceKey: "open_targets",
    displayName: "Open Targets Platform",
    databaseVersion: null,
    license: "CC0 1.0 Universal",
    url: "https://platform.opentargets.org",
    snapshotDate: null,
  },
  {
    sourceKey: "gwas_catalog",
    displayName: "GWAS Catalog (EBI/NHGRI)",
    databaseVersion: null,
    license: "EMBL-EBI Terms of Use (open, attribution requested)",
    url: "https://www.ebi.ac.uk/gwas",
    snapshotDate: null,
  },
  {
    sourceKey: "clinvar",
    displayName: "ClinVar (NCBI)",
    databaseVersion: null,
    license: "NCBI Public Domain (US Government work)",
    url: "https://www.ncbi.nlm.nih.gov/clinvar",
    snapshotDate: null,
  },
  {
    sourceKey: "chembl",
    displayName: "ChEMBL (EMBL-EBI)",
    databaseVersion: null,
    license: "CC BY-SA 3.0",
    url: "https://www.ebi.ac.uk/chembl",
    snapshotDate: null,
  },
  {
    sourceKey: "pharmgkb",
    displayName: "PharmGKB",
    databaseVersion: null,
    license: "CC BY-SA 4.0 (attribution, non-commercial data use terms apply)",
    url: "https://www.pharmgkb.org",
    snapshotDate: null,
  },
  {
    sourceKey: "faers",
    displayName: "FDA Adverse Event Reporting System (FAERS)",
    databaseVersion: null,
    license: "US Public Domain (openFDA / FDA)",
    url: "https://open.fda.gov/data/faers",
    snapshotDate: null,
  },
  {
    sourceKey: "pubtator",
    displayName: "PubTator Central (NCBI)",
    databaseVersion: null,
    license: "NCBI Public Domain (US Government work)",
    url: "https://www.ncbi.nlm.nih.gov/research/pubtator",
    snapshotDate: null,
  },
  {
    sourceKey: "pubmed",
    displayName: "PubMed (NCBI/NLM)",
    databaseVersion: null,
    license: "NLM Terms and Conditions (abstracts; open access)",
    url: "https://pubmed.ncbi.nlm.nih.gov",
    snapshotDate: null,
  },
  {
    sourceKey: "clinicaltrials",
    displayName: "ClinicalTrials.gov (NIH/NLM)",
    databaseVersion: null,
    license: "NLM Terms and Conditions (US Public Domain data)",
    url: "https://clinicaltrials.gov",
    snapshotDate: null,
  },
];

// ---------------------------------------------------------------------------
// Row mappers (snake_case DB rows -> camelCase domain objects)
// ---------------------------------------------------------------------------

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

interface DataSourceRow {
  id: string;
  source_key: string;
  display_name: string;
  database_version: string | null;
  license: string | null;
  url: string | null;
  last_accessed_at: Date | string | null;
  snapshot_date: Date | string | null;
  created_at: Date | string;
}

function mapSource(row: DataSourceRow): DataSource {
  return {
    id: row.id,
    sourceKey: row.source_key,
    displayName: row.display_name,
    databaseVersion: row.database_version,
    license: row.license,
    url: row.url,
    lastAccessedAt: toIsoOrNull(row.last_accessed_at),
    // A DATE column comes back as a Date/string; expose the calendar day only.
    snapshotDate:
      row.snapshot_date === null
        ? null
        : toIso(row.snapshot_date).slice(0, 10),
    createdAt: toIso(row.created_at),
  };
}

interface AccessRow {
  id: string;
  source_key: string;
  org_id: string | null;
  purpose: string;
  accessed_at: Date | string;
}

function mapAccess(row: AccessRow): SourceAccess {
  return {
    id: row.id,
    sourceKey: row.source_key,
    orgId: row.org_id,
    purpose: row.purpose,
    accessedAt: toIso(row.accessed_at),
  };
}

const SOURCE_COLUMNS = `
  id, source_key, display_name, database_version, license, url,
  last_accessed_at, snapshot_date, created_at
`;

// ---------------------------------------------------------------------------
// Registry (public reference facts — NOT org-scoped)
// ---------------------------------------------------------------------------

// Idempotently insert or update one source's reference metadata. Conflicts on the
// unique source_key. database_version / snapshot_date are COALESCEd so a bare
// re-seed never clobbers an operationally-set snapshot with null.
export async function upsertSource(
  pool: Pool,
  entry: CatalogEntry
): Promise<DataSource> {
  const { rows } = await pool.query<DataSourceRow>(
    `insert into evidence_data_sources
       (source_key, display_name, database_version, license, url, snapshot_date)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (source_key) do update set
       display_name = excluded.display_name,
       database_version = coalesce(excluded.database_version, evidence_data_sources.database_version),
       license = excluded.license,
       url = excluded.url,
       snapshot_date = coalesce(excluded.snapshot_date, evidence_data_sources.snapshot_date)
     returning ${SOURCE_COLUMNS}`,
    [
      entry.sourceKey,
      entry.displayName,
      entry.databaseVersion,
      entry.license,
      entry.url,
      entry.snapshotDate,
    ]
  );
  return mapSource(rows[0]);
}

// Seed the registry from the static catalog. Idempotent — safe to run on every
// boot; each entry is upserted so reference facts stay current without dupes.
export async function seedCatalog(pool: Pool): Promise<DataSource[]> {
  const out: DataSource[] = [];
  for (const entry of DATA_SOURCE_CATALOG) {
    out.push(await upsertSource(pool, entry));
  }
  return out;
}

// The full registry, ordered by display name. Public reference facts, so this is
// deliberately NOT org-scoped.
export async function listSources(pool: Pool): Promise<DataSource[]> {
  const { rows } = await pool.query<DataSourceRow>(
    `select ${SOURCE_COLUMNS}
       from evidence_data_sources
      order by display_name asc`
  );
  return rows.map(mapSource);
}

// ---------------------------------------------------------------------------
// Access log (ORG-SCOPED)
// ---------------------------------------------------------------------------

// Record that a source was consulted for a purpose. Writes an append-only access
// row and bumps the source's last_accessed_at, both in one transaction so the
// registry timestamp and the log never drift. orgId is the RESOLVED ctx.org.id
// (or null for a platform-internal access) — never a client-supplied value.
export async function recordAccess(
  pool: Pool,
  sourceKey: string,
  orgId: string | null,
  purpose: string
): Promise<SourceAccess> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<AccessRow>(
      `insert into evidence_source_accesses (source_key, org_id, purpose)
       values ($1, $2, $3)
       returning id, source_key, org_id, purpose, accessed_at`,
      [sourceKey, orgId, purpose]
    );
    await client.query(
      `update evidence_data_sources
          set last_accessed_at = now()
        where source_key = $1`,
      [sourceKey]
    );
    await client.query("commit");
    return mapAccess(rows[0]);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// The org's recent source accesses, newest first. org_id is ALWAYS the first
// predicate: a tenant sees only its own provenance trail, never another's, and
// never the null-org platform-internal accesses.
export async function getAccessLog(
  pool: Pool,
  orgId: string,
  limit = 50
): Promise<SourceAccess[]> {
  const { rows } = await pool.query<AccessRow>(
    `select id, source_key, org_id, purpose, accessed_at
       from evidence_source_accesses
      where org_id = $1
      order by accessed_at desc
      limit $2`,
    [orgId, limit]
  );
  return rows.map(mapAccess);
}

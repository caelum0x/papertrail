import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/rateLimit";
import { logEvent } from "@/lib/logger";

// Public SOURCE QUALITY REPORT endpoint. Reports the state of the shared `sources` cache
// and its ingest-time entity linking, WITHOUT re-running any ingest:
//   - per-source_type document counts (how many cached rows each database contributed),
//   - entity-coverage stats derived from `document_entities` (how many documents have at
//     least one linked canonical entity, and the distinct canonical entities / ontologies
//     linked across the corpus).
//
// This is a read-only aggregate over cached rows — it never touches an upstream API, so it
// is safe on a cold demo (CLAUDE.md caching rule). Sources are a PUBLIC, unscoped resource
// here (see /api/sources), so this mirrors the public compute routes: nodejs runtime, IP
// rate limit, ok/fail envelope, try/catch. NEVER logs source text — only ids and counts.
export const runtime = "nodejs";

// The entity tables are provisioned by the ingest-migration part; guard every read behind
// to_regclass so this report degrades gracefully (zeros, never a 500) before that migration
// has been applied, rather than coupling the console panel to migration ordering.

interface SourceTypeCount {
  source_type: string;
  document_count: number;
}

interface OntologyCount {
  ontology: string;
  entity_count: number;
}

export interface QualityReport {
  totalDocuments: number;
  perSourceType: SourceTypeCount[];
  entityCoverage: {
    documentsWithEntities: number;
    documentsWithoutEntities: number;
    coverageRatio: number; // documentsWithEntities / totalDocuments, 0 when no documents
    totalEntityLinks: number;
    distinctCanonicalEntities: number;
    perOntology: OntologyCount[];
  };
  entityTablePresent: boolean;
}

async function tableExists(
  pool: import("pg").Pool,
  table: string
): Promise<boolean> {
  const { rows } = await pool.query<{ present: string | null }>(
    `select to_regclass($1) as present`,
    [`public.${table}`]
  );
  return Boolean(rows[0]?.present);
}

async function loadPerSourceType(pool: import("pg").Pool): Promise<SourceTypeCount[]> {
  const { rows } = await pool.query<{ source_type: string; document_count: string }>(
    `select source_type, count(*)::bigint as document_count
       from sources
      group by source_type
      order by document_count desc, source_type asc`
  );
  return rows.map((r) => ({
    source_type: r.source_type,
    document_count: Number(r.document_count),
  }));
}

export async function GET(req: NextRequest) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";

  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    logEvent("sources.quality_report.rate_limited", { ip });
    return fail("Rate limit reached. Please try again shortly.", 429);
  }

  try {
    const pool = getPool();

    const perSourceType = await loadPerSourceType(pool);
    const totalDocuments = perSourceType.reduce((sum, r) => sum + r.document_count, 0);

    const entityTablePresent = await tableExists(pool, "document_entities");

    let documentsWithEntities = 0;
    let totalEntityLinks = 0;
    let distinctCanonicalEntities = 0;
    let perOntology: OntologyCount[] = [];

    if (entityTablePresent) {
      // One aggregate pass for the corpus-wide entity-link totals.
      const totals = await pool.query<{
        documents_with_entities: string;
        total_links: string;
        distinct_entities: string;
      }>(
        `select count(distinct source_id)::bigint as documents_with_entities,
                count(*)::bigint                   as total_links,
                count(distinct curie)::bigint      as distinct_entities
           from document_entities`
      );
      const t = totals.rows[0];
      documentsWithEntities = Number(t?.documents_with_entities ?? 0);
      totalEntityLinks = Number(t?.total_links ?? 0);
      distinctCanonicalEntities = Number(t?.distinct_entities ?? 0);

      // Distinct canonical entities linked per ontology (breadth of the linking).
      const byOntology = await pool.query<{ ontology: string; entity_count: string }>(
        `select coalesce(ontology, 'unknown') as ontology,
                count(distinct curie)::bigint  as entity_count
           from document_entities
          group by coalesce(ontology, 'unknown')
          order by entity_count desc, ontology asc`
      );
      perOntology = byOntology.rows.map((r) => ({
        ontology: r.ontology,
        entity_count: Number(r.entity_count),
      }));
    }

    const documentsWithoutEntities = Math.max(0, totalDocuments - documentsWithEntities);
    const coverageRatio =
      totalDocuments > 0 ? documentsWithEntities / totalDocuments : 0;

    const report: QualityReport = {
      totalDocuments,
      perSourceType,
      entityCoverage: {
        documentsWithEntities,
        documentsWithoutEntities,
        coverageRatio,
        totalEntityLinks,
        distinctCanonicalEntities,
        perOntology,
      },
      entityTablePresent,
    };

    logEvent("sources.quality_report.success", {
      latencyMs: Date.now() - start,
      totalDocuments,
      sourceTypes: perSourceType.length,
      documentsWithEntities,
      totalEntityLinks,
    });

    return ok(report);
  } catch (err) {
    logEvent("sources.quality_report.error", {
      latencyMs: Date.now() - start,
      error: String(err),
    });
    console.error("[/api/sources/quality-report] failed:", err);
    return fail(
      "Something went wrong while building the source quality report. This has been logged — please try again.",
      500
    );
  }
}

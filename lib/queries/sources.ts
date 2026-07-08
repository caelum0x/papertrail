import { getPool } from "@/lib/db";

// Centralized SQL for the source read endpoints. Route handlers parse/clamp
// params; all SQL lives here. Parameterized queries only.

export interface SourceListItem {
  id: string;
  source_type: string;
  external_id: string;
  title: string | null;
  url: string;
}

export interface ListSourcesParams {
  limit: number;
  offset: number;
  q?: string;
}

export interface ListSourcesResult {
  items: SourceListItem[];
  total: number;
}

export interface SourceDetailRow {
  id: string;
  source_type: string;
  external_id: string;
  title: string | null;
  url: string;
  raw_text: string;
}

export interface SourceVerificationRow {
  id: string;
  claim_text: string;
  discrepancy_type: string;
  trust_score: number;
  created_at: string;
}

export interface SourceWithVerifications {
  source: SourceDetailRow;
  verifications: SourceVerificationRow[];
}

interface CountRow {
  count: string;
}

export async function listSources({
  limit,
  offset,
  q,
}: ListSourcesParams): Promise<ListSourcesResult> {
  const pool = getPool();

  // Search matches either the human title or the external id (e.g. PMID/NCT).
  const whereClause = q ? "WHERE title ILIKE $1 OR external_id ILIKE $1" : "";
  const pattern = q ? `%${q}%` : null;

  const listParams: unknown[] = q ? [pattern, limit, offset] : [limit, offset];
  const limitIdx = q ? "$2" : "$1";
  const offsetIdx = q ? "$3" : "$2";

  const [itemsResult, countResult] = await Promise.all([
    pool.query<SourceListItem>(
      `SELECT id, source_type, external_id, title, url
       FROM sources
       ${whereClause}
       ORDER BY fetched_at DESC
       LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      listParams
    ),
    pool.query<CountRow>(
      `SELECT count(*) AS count FROM sources ${whereClause}`,
      q ? [pattern] : []
    ),
  ]);

  return {
    items: itemsResult.rows,
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function getSourceWithVerifications(
  id: string
): Promise<SourceWithVerifications | null> {
  const pool = getPool();

  const sourceResult = await pool.query<SourceDetailRow>(
    `SELECT id, source_type, external_id, title, url, raw_text
     FROM sources
     WHERE id = $1`,
    [id]
  );

  const source = sourceResult.rows[0];
  if (!source) {
    return null;
  }

  const verificationsResult = await pool.query<SourceVerificationRow>(
    `SELECT id, claim_text, discrepancy_type, trust_score, created_at
     FROM verifications
     WHERE matched_source_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [id]
  );

  return {
    source,
    verifications: verificationsResult.rows,
  };
}

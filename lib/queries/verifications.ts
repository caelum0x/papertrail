import { getPool } from "@/lib/db";
import { FlaggedSpan } from "@/lib/schemas";

// Centralized SQL for the verification read endpoints. Route handlers stay thin:
// they parse/clamp query params and shape responses; all SQL (and parameterization)
// lives here. Every query is parameterized — never interpolate user input.

export interface VerificationListItem {
  id: string;
  claim_text: string;
  discrepancy_type: string;
  trust_score: number;
  created_at: string;
}

export interface ListVerificationsParams {
  limit: number;
  offset: number;
  discrepancyType?: string;
}

export interface ListVerificationsResult {
  items: VerificationListItem[];
  total: number;
}

// Full verification joined to its (possibly missing) source. Consumed by the
// [id] route, which re-grounds spans + reconciles against the current source text.
export interface VerificationRow {
  id: string;
  claim_text: string;
  matched_source_id: string | null;
  discrepancy_type: string;
  trust_score: number;
  explanation: string;
  flagged_spans: FlaggedSpan[] | null;
  created_at: Date;
  title: string | null;
  url: string | null;
  source_type: string | null;
  external_id: string | null;
  raw_text: string | null;
}

interface CountRow {
  count: string;
}

const SELECT_VERIFICATION = `
  select
    v.*,
    s.title,
    s.url,
    s.source_type,
    s.external_id,
    s.raw_text
  from verifications v
  left join sources s on v.matched_source_id = s.id
  where v.id = $1
`;

export async function listVerifications({
  limit,
  offset,
  discrepancyType,
}: ListVerificationsParams): Promise<ListVerificationsResult> {
  const pool = getPool();

  const whereClause = discrepancyType ? "WHERE discrepancy_type = $1" : "";

  const listParams: unknown[] = discrepancyType
    ? [discrepancyType, limit, offset]
    : [limit, offset];
  const limitIdx = discrepancyType ? "$2" : "$1";
  const offsetIdx = discrepancyType ? "$3" : "$2";

  const [itemsResult, countResult] = await Promise.all([
    pool.query<VerificationListItem>(
      `SELECT id, claim_text, discrepancy_type, trust_score, created_at
       FROM verifications
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      listParams
    ),
    pool.query<CountRow>(
      `SELECT count(*) AS count FROM verifications ${whereClause}`,
      discrepancyType ? [discrepancyType] : []
    ),
  ]);

  return {
    items: itemsResult.rows,
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function getVerificationRow(
  id: string
): Promise<VerificationRow | null> {
  const result = await getPool().query<VerificationRow>(SELECT_VERIFICATION, [id]);
  return result.rows[0] ?? null;
}

import { getPool } from "@/lib/db";

// Centralized aggregate stats query. Mirrors exactly what the /api/stats route
// previously computed inline, so the response contract is unchanged.

export interface AggregateStats {
  total_verifications: number;
  total_sources: number;
  avg_trust_score: number | null;
  by_discrepancy_type: Record<string, number>;
  flagged_rate: number;
}

interface CountRow {
  count: string;
}

interface AvgRow {
  avg: string | null;
}

interface DiscrepancyRow {
  discrepancy_type: string;
  count: string;
}

export async function getAggregateStats(): Promise<AggregateStats> {
  const pool = getPool();

  const [verificationsCount, sourcesCount, avgTrust, byType] = await Promise.all([
    pool.query<CountRow>("SELECT count(*) AS count FROM verifications"),
    pool.query<CountRow>("SELECT count(*) AS count FROM sources"),
    pool.query<AvgRow>("SELECT avg(trust_score) AS avg FROM verifications"),
    pool.query<DiscrepancyRow>(
      "SELECT discrepancy_type, count(*) AS count FROM verifications GROUP BY discrepancy_type"
    ),
  ]);

  const totalVerifications = Number(verificationsCount.rows[0]?.count ?? 0);
  const totalSources = Number(sourcesCount.rows[0]?.count ?? 0);

  const avgRaw = avgTrust.rows[0]?.avg;
  const avgTrustScore =
    avgRaw === null || avgRaw === undefined ? null : Math.round(Number(avgRaw));

  const byDiscrepancyType: Record<string, number> = {};
  let flaggedCount = 0;
  for (const row of byType.rows) {
    const count = Number(row.count);
    byDiscrepancyType[row.discrepancy_type] = count;
    if (row.discrepancy_type !== "accurate") {
      flaggedCount += count;
    }
  }

  const flaggedRate =
    totalVerifications > 0 ? flaggedCount / totalVerifications : 0;

  return {
    total_verifications: totalVerifications,
    total_sources: totalSources,
    avg_trust_score: avgTrustScore,
    by_discrepancy_type: byDiscrepancyType,
    flagged_rate: flaggedRate,
  };
}

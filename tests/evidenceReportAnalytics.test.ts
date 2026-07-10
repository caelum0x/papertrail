import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import { evidenceReportAnalytics } from "@/lib/evidenceReports/analytics";

// Minimal unit test with a mocked pool. The five parallel aggregate queries are
// dispatched via Promise.all, so we match each by the SQL it runs rather than by
// call order, then assert the folded shape.
function makePool(): Pool {
  const query = async (sql: string) => {
    if (sql.includes("count(*)::int as total")) {
      return { rows: [{ total: 3 }] };
    }
    if (sql.includes("group by certainty")) {
      return {
        rows: [
          { certainty: "high", count: 2 },
          { certainty: "very_low", count: 1 },
          { certainty: "bogus", count: 5 }, // unknown bucket is ignored
        ],
      };
    }
    if (sql.includes("group by verdict")) {
      return {
        rows: [
          { verdict: "supported", count: 2 },
          { verdict: null, count: 1 },
        ],
      };
    }
    if (sql.includes("order by created_at desc")) {
      return {
        rows: [
          {
            id: "r1",
            claim: "Drug X reduced events by 30%",
            certainty: "high",
            verdict: "supported",
            created_at: new Date("2026-07-01T00:00:00Z"),
          },
        ],
      };
    }
    if (sql.includes("date_trunc('month'")) {
      return {
        rows: [{ month: new Date("2026-07-01T00:00:00Z"), count: 3 }],
      };
    }
    throw new Error(`unexpected sql: ${sql}`);
  };
  return { query } as unknown as Pool;
}

describe("evidenceReportAnalytics", () => {
  it("aggregates org-scoped reports into the summary shape", async () => {
    const result = await evidenceReportAnalytics(makePool(), { orgId: "org-1" });

    expect(result.total).toBe(3);
    expect(result.byCertainty).toEqual({ high: 2, moderate: 0, low: 0, very_low: 1 });
    expect(result.byVerdict).toEqual({ supported: 2, unknown: 1 });
    expect(result.recent).toHaveLength(1);
    expect(result.recent[0].id).toBe("r1");
    expect(result.recent[0].createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(result.perMonth).toEqual([{ month: "2026-07", count: 3 }]);
  });
});

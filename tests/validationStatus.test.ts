import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import {
  computeValidationStatus,
  recordValidationRun,
  listValidationRuns,
  COVERAGE_WEIGHT,
  SOURCE_WEIGHT,
  type ValidationStatus,
} from "@/lib/validation/status";

// ---- computeValidationStatus: PURE + deterministic ------------------------

describe("computeValidationStatus", () => {
  it("marks a full run complete: all required engines ran, all sources reachable", () => {
    const s = computeValidationStatus({
      enginesRun: ["meta", "grade", "bias"],
      requiredEngines: ["meta", "grade", "bias"],
      sourcesReachable: { pubmed: true, ctgov: true },
    });
    expect(s.coverage).toBe(1);
    expect(s.sourceReachability).toBe(1);
    expect(s.qualityScore).toBe(1);
    expect(s.status).toBe("complete");
    expect(s.ranRequiredCount).toBe(3);
    expect(s.requiredCount).toBe(3);
    expect(s.reachableSourceCount).toBe(2);
    expect(s.knownSourceCount).toBe(2);
  });

  it("computes coverage as ran-of-required and applies the documented weighting", () => {
    // 2 of 4 required engines ran (coverage 0.5); 1 of 2 sources reachable (0.5).
    const s = computeValidationStatus({
      enginesRun: ["meta", "grade", "extra_not_required"],
      requiredEngines: ["meta", "grade", "bias", "sensitivity"],
      sourcesReachable: { pubmed: true, ctgov: false },
    });
    expect(s.coverage).toBe(0.5);
    expect(s.sourceReachability).toBe(0.5);
    // 0.7*0.5 + 0.3*0.5 = 0.5 exactly.
    expect(s.qualityScore).toBe(COVERAGE_WEIGHT * 0.5 + SOURCE_WEIGHT * 0.5);
    expect(s.qualityScore).toBe(0.5);
    // qualityScore >= 0.5 partial threshold, but < complete -> partial.
    expect(s.status).toBe("partial");
    expect(s.ranRequiredCount).toBe(2);
    expect(s.requiredCount).toBe(4);
  });

  it("weights coverage above source reachability", () => {
    // Same total 'work' but concentrated differently. Full engine coverage with a
    // dead source must beat full sources with half the engines.
    const enginesStrong = computeValidationStatus({
      enginesRun: ["a", "b"],
      requiredEngines: ["a", "b"],
      sourcesReachable: { s1: false, s2: false },
    });
    const sourcesStrong = computeValidationStatus({
      enginesRun: ["a"],
      requiredEngines: ["a", "b"],
      sourcesReachable: { s1: true, s2: true },
    });
    // enginesStrong: 0.7*1 + 0.3*0 = 0.7 ; sourcesStrong: 0.7*0.5 + 0.3*1 = 0.65
    expect(enginesStrong.qualityScore).toBe(0.7);
    expect(sourcesStrong.qualityScore).toBe(0.65);
    expect(enginesStrong.qualityScore).toBeGreaterThan(sourcesStrong.qualityScore);
  });

  it("marks a run insufficient when quality falls below the partial threshold", () => {
    // 1 of 4 engines (coverage 0.25), no reachable sources.
    const s = computeValidationStatus({
      enginesRun: ["meta"],
      requiredEngines: ["meta", "grade", "bias", "sensitivity"],
      sourcesReachable: { pubmed: false },
    });
    // 0.7*0.25 + 0.3*0 = 0.175 < 0.5.
    expect(s.qualityScore).toBe(0.175);
    expect(s.status).toBe("insufficient");
  });

  it("does not mark complete when coverage is full but a source is unreachable", () => {
    const s = computeValidationStatus({
      enginesRun: ["a", "b"],
      requiredEngines: ["a", "b"],
      sourcesReachable: { s1: true, s2: false },
    });
    expect(s.coverage).toBe(1);
    // 0.7*1 + 0.3*0.5 = 0.85 -> below the complete threshold of 1.
    expect(s.qualityScore).toBe(0.85);
    expect(s.status).toBe("partial");
  });

  it("treats no requirements and no known sources as vacuously complete", () => {
    const s = computeValidationStatus({
      enginesRun: [],
      requiredEngines: [],
      sourcesReachable: {},
    });
    expect(s.coverage).toBe(1);
    expect(s.sourceReachability).toBe(1);
    expect(s.qualityScore).toBe(1);
    expect(s.status).toBe("complete");
  });

  it("de-duplicates required engines so coverage math is stable", () => {
    const s = computeValidationStatus({
      enginesRun: ["a"],
      requiredEngines: ["a", "a", "b"],
      sourcesReachable: {},
    });
    // Distinct required = {a, b}; ran a -> coverage 0.5, not 1/3.
    expect(s.coverage).toBe(0.5);
    expect(s.requiredCount).toBe(2);
  });

  it("is deterministic: identical inputs yield identical reports", () => {
    const input = {
      enginesRun: ["meta", "grade"],
      requiredEngines: ["meta", "grade", "bias"],
      sourcesReachable: { pubmed: true, ctgov: false },
    };
    expect(computeValidationStatus(input)).toEqual(computeValidationStatus(input));
  });
});

// ---- org-scoped persistence over a mock pool ------------------------------

interface Captured {
  sql: string;
  values: unknown[];
}

function makePool(captured: Captured[]): Pool {
  const query = async (sql: string, values: unknown[] = []) => {
    captured.push({ sql, values });
    if (sql.includes("count(*)::int as total")) {
      return { rows: [{ total: 2 }] };
    }
    if (sql.trim().startsWith("insert into validation_runs")) {
      return {
        rows: [
          {
            id: "run-1",
            org_id: values[0],
            subject: values[1],
            engines_run: JSON.parse(values[2] as string),
            sources_reachable: JSON.parse(values[3] as string),
            coverage: values[4],
            quality_score: values[5],
            status: values[6],
            created_at: new Date("2026-07-10T00:00:00Z"),
          },
        ],
      };
    }
    // list select
    return {
      rows: [
        {
          id: "run-2",
          org_id: values[0],
          subject: "Drug X reduced events by 30%",
          engines_run: ["meta", "grade"],
          sources_reachable: { pubmed: true },
          coverage: "0.6667",
          quality_score: "0.7667",
          status: "partial",
          created_at: new Date("2026-07-09T00:00:00Z"),
        },
      ],
    };
  };
  return { query } as unknown as Pool;
}

const sampleStatus: ValidationStatus = {
  coverage: 0.5,
  sourceReachability: 0.5,
  qualityScore: 0.5,
  status: "partial",
  ranRequiredCount: 1,
  requiredCount: 2,
  reachableSourceCount: 1,
  knownSourceCount: 2,
};

describe("recordValidationRun (org-scoped persistence)", () => {
  it("writes org_id as the first column and persists the computed status", async () => {
    const captured: Captured[] = [];
    const pool = makePool(captured);

    const record = await recordValidationRun(
      pool,
      "org-1",
      "Drug X reduced events by 30%",
      sampleStatus,
      ["meta", "meta", "grade"],
      { pubmed: true, ctgov: false }
    );

    const insert = captured.find((c) =>
      c.sql.trim().startsWith("insert into validation_runs")
    );
    expect(insert).toBeDefined();
    // org_id is the first bound value — never trust a client org_id.
    expect(insert!.values[0]).toBe("org-1");
    expect(insert!.values[1]).toBe("Drug X reduced events by 30%");
    // engines de-duplicated on the way in.
    expect(JSON.parse(insert!.values[2] as string)).toEqual(["meta", "grade"]);
    // coverage/quality/status come from the computed status, not the client.
    expect(insert!.values[4]).toBe(0.5);
    expect(insert!.values[5]).toBe(0.5);
    expect(insert!.values[6]).toBe("partial");

    expect(record.id).toBe("run-1");
    expect(record.orgId).toBe("org-1");
    expect(record.status).toBe("partial");
    expect(record.coverage).toBe(0.5);
    expect(record.createdAt).toBe("2026-07-10T00:00:00.000Z");
  });
});

describe("listValidationRuns (org-scoped)", () => {
  it("filters by org_id first, orders newest-first, and returns a total", async () => {
    const captured: Captured[] = [];
    const pool = makePool(captured);

    const { items, total } = await listValidationRuns(pool, "org-1", 20, 0);

    const countQ = captured.find((c) => c.sql.includes("count(*)::int as total"));
    const listQ = captured.find((c) => c.sql.includes("order by created_at desc"));
    expect(countQ!.sql).toContain("where org_id = $1");
    expect(countQ!.values[0]).toBe("org-1");
    expect(listQ!.sql).toContain("where org_id = $1");
    expect(listQ!.values).toEqual(["org-1", 20, 0]);

    expect(total).toBe(2);
    expect(items).toHaveLength(1);
    expect(items[0].orgId).toBe("org-1");
    // numeric columns arrive as strings from pg; they are coerced to numbers.
    expect(items[0].coverage).toBe(0.6667);
    expect(items[0].qualityScore).toBe(0.7667);
    expect(items[0].enginesRun).toEqual(["meta", "grade"]);
    expect(items[0].sourcesReachable).toEqual({ pubmed: true });
  });
});

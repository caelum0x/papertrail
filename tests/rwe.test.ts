import { describe, it, expect, vi } from "vitest";
import {
  adverseEventTrend,
  evidenceVolumeTrend,
  rweProfile,
  olsSlope,
  classifyDirection,
  classifyMaturity,
  buildSummary,
  defaultYears,
  type AdverseEventTrendDeps,
  type EvidenceVolumeTrendDeps,
} from "../lib/rwe/signals";
import { disproportionality, type Faers2x2 } from "../lib/bio/pharmacovigilance";
import { RweRequestSchema, RweProfileSchema } from "../lib/rwe/schemas";

// These tests exercise the DETERMINISTIC RWE signal engine over MOCKED yearly
// counts — no live network. The contracts under test:
//   1. per-year disproportionality equals the oracle-tested engine on the same 2x2
//   2. the IC OLS slope + rising/stable/falling classification
//   3. the emerging/active/established maturity thresholds
//   4. honest-empty behaviour on failure (nulls, never fabricated numbers)

// A rising-IC scenario: the (drug+event) `a` cell grows each year against a fixed
// background, so the observed/expected reporting ratio — and hence IC — climbs.
const RISING_TABLES: Record<number, Faers2x2> = {
  2021: { a: 5, b: 2000, c: 200, d: 50000 },
  2022: { a: 15, b: 2000, c: 200, d: 50000 },
  2023: { a: 40, b: 2000, c: 200, d: 50000 },
  2024: { a: 90, b: 2000, c: 200, d: 50000 },
};

function fetcherFrom(tables: Record<number, Faers2x2 | null>): AdverseEventTrendDeps["fetchYearly2x2"] {
  return vi.fn(async (_drug: string, _event: string, year: number) => tables[year] ?? null);
}

describe("olsSlope — pure deterministic slope", () => {
  it("recovers a known positive slope", () => {
    // y = 2x + 1 over x = 0..3 -> slope exactly 2.
    const slope = olsSlope([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ]);
    expect(slope).toBeCloseTo(2, 10);
  });

  it("returns null with fewer than two points", () => {
    expect(olsSlope([{ x: 2020, y: 1 }])).toBeNull();
    expect(olsSlope([])).toBeNull();
  });

  it("returns null when x has zero variance", () => {
    expect(
      olsSlope([
        { x: 2020, y: 1 },
        { x: 2020, y: 5 },
      ])
    ).toBeNull();
  });
});

describe("classifyDirection — documented dead-band", () => {
  it("rising above +0.05, falling below -0.05, stable inside", () => {
    expect(classifyDirection(0.2)).toBe("rising");
    expect(classifyDirection(-0.2)).toBe("falling");
    expect(classifyDirection(0.01)).toBe("stable");
    expect(classifyDirection(-0.01)).toBe("stable");
    expect(classifyDirection(null)).toBe("stable");
  });
});

describe("adverseEventTrend — per-year disproportionality + direction", () => {
  const deps: AdverseEventTrendDeps = {
    fetchYearly2x2: fetcherFrom(RISING_TABLES),
    years: [2021, 2022, 2023, 2024],
  };

  it("each year's PRR/IC equal the oracle engine on the same 2x2", async () => {
    const trend = (await adverseEventTrend({ drug: "drugx", event: "myopathy" }, deps))!;
    expect(trend.years).toHaveLength(4);

    for (const y of trend.years) {
      const expected = disproportionality(RISING_TABLES[y.year])!;
      expect(y.reports).toBe(RISING_TABLES[y.year].a);
      expect(y.prr).toBeCloseTo(expected.prr, 10);
      expect(y.ic).toBeCloseTo(expected.informationComponent, 10);
      expect(y.ic025).toBeCloseTo(expected.ic025, 10);
    }
  });

  it("classifies a growing IC as rising with a positive slope", async () => {
    const trend = (await adverseEventTrend({ drug: "drugx", event: "myopathy" }, deps))!;
    expect(trend.icSlope).not.toBeNull();
    expect(trend.icSlope!).toBeGreaterThan(0);
    expect(trend.direction).toBe("rising");
    expect(trend.totalReports).toBe(5 + 15 + 40 + 90);
  });

  it("classifies a shrinking IC as falling", async () => {
    // Reverse the growth: `a` decreases year over year -> IC falls.
    const falling: Record<number, Faers2x2> = {
      2021: { a: 90, b: 2000, c: 200, d: 50000 },
      2022: { a: 40, b: 2000, c: 200, d: 50000 },
      2023: { a: 15, b: 2000, c: 200, d: 50000 },
      2024: { a: 5, b: 2000, c: 200, d: 50000 },
    };
    const trend = (await adverseEventTrend(
      { drug: "drugx", event: "myopathy" },
      { fetchYearly2x2: fetcherFrom(falling), years: [2021, 2022, 2023, 2024] }
    ))!;
    expect(trend.icSlope!).toBeLessThan(0);
    expect(trend.direction).toBe("falling");
  });

  it("classifies a flat IC as stable", async () => {
    const flat: Record<number, Faers2x2> = {
      2021: { a: 25, b: 2000, c: 200, d: 50000 },
      2022: { a: 25, b: 2000, c: 200, d: 50000 },
      2023: { a: 25, b: 2000, c: 200, d: 50000 },
      2024: { a: 25, b: 2000, c: 200, d: 50000 },
    };
    const trend = (await adverseEventTrend(
      { drug: "drugx", event: "myopathy" },
      { fetchYearly2x2: fetcherFrom(flat), years: [2021, 2022, 2023, 2024] }
    ))!;
    expect(trend.icSlope!).toBeCloseTo(0, 6);
    expect(trend.direction).toBe("stable");
  });

  it("records a missing/failed year as 0 reports with null stats, excluded from the fit", async () => {
    const tables: Record<number, Faers2x2 | null> = {
      2021: { a: 5, b: 2000, c: 200, d: 50000 },
      2022: null, // fetch failure / no data
      2023: { a: 40, b: 2000, c: 200, d: 50000 },
      2024: { a: 90, b: 2000, c: 200, d: 50000 },
    };
    const trend = (await adverseEventTrend(
      { drug: "drugx", event: "myopathy" },
      { fetchYearly2x2: fetcherFrom(tables), years: [2021, 2022, 2023, 2024] }
    ))!;
    const missing = trend.years.find((y) => y.year === 2022)!;
    expect(missing.reports).toBe(0);
    expect(missing.prr).toBeNull();
    expect(missing.ic).toBeNull();
    // Still rising off the three real points.
    expect(trend.direction).toBe("rising");
  });

  it("returns a stable, zero-report trend when every year is empty (honest, not fabricated)", async () => {
    const trend = (await adverseEventTrend(
      { drug: "drugx", event: "myopathy" },
      { fetchYearly2x2: fetcherFrom({}), years: [2021, 2022] }
    ))!;
    expect(trend.totalReports).toBe(0);
    expect(trend.icSlope).toBeNull();
    expect(trend.direction).toBe("stable");
    expect(trend.years.every((y) => y.ic === null)).toBe(true);
  });

  it("survives a throwing fetcher (transport error -> null year)", async () => {
    const throwing: AdverseEventTrendDeps = {
      fetchYearly2x2: vi.fn(async () => {
        throw new Error("network down");
      }),
      years: [2021, 2022],
    };
    const trend = (await adverseEventTrend({ drug: "d", event: "e" }, throwing))!;
    expect(trend.totalReports).toBe(0);
    expect(trend.direction).toBe("stable");
  });

  it("returns null for blank drug or event", async () => {
    expect(await adverseEventTrend({ drug: "  ", event: "e" }, deps)).toBeNull();
    expect(await adverseEventTrend({ drug: "d", event: "" }, deps)).toBeNull();
  });
});

describe("classifyMaturity — documented volume/recency thresholds", () => {
  it("established when total >= 500 regardless of recency", () => {
    const series = [
      { year: 2019, count: 300 },
      { year: 2020, count: 300 },
    ];
    expect(classifyMaturity(series, 0)).toBe("established");
  });

  it("emerging when total <= 60 and >= 50% is recent", () => {
    const series = [
      { year: 2019, count: 5 },
      { year: 2022, count: 10 },
      { year: 2023, count: 15 },
      { year: 2024, count: 20 },
    ];
    // recent window (2022-2024) = 45 of 50 -> 90% recent, total 50 <= 60.
    expect(classifyMaturity(series, 45)).toBe("emerging");
  });

  it("active when total is mid-range", () => {
    const series = [
      { year: 2019, count: 100 },
      { year: 2020, count: 100 },
    ];
    expect(classifyMaturity(series, 0)).toBe("active");
  });

  it("active when small total but NOT recency-concentrated", () => {
    const series = [
      { year: 2019, count: 40 },
      { year: 2024, count: 10 },
    ];
    // total 50 <= 60 but only 10/50 = 20% recent -> not emerging.
    expect(classifyMaturity(series, 10)).toBe("active");
  });
});

describe("evidenceVolumeTrend — per-year counts + maturity", () => {
  function countDeps(
    pub: Record<number, number | null>,
    trials: Record<number, number | null>,
    years: number[]
  ): EvidenceVolumeTrendDeps {
    return {
      fetchPublicationCount: vi.fn(async (_q: string, y: number) => pub[y] ?? null),
      fetchTrialStartCount: vi.fn(async (_q: string, y: number) => trials[y] ?? null),
      years,
    };
  }

  it("sums per-year counts and classifies an established topic", async () => {
    const trend = (await evidenceVolumeTrend(
      { topic: "statin cardiovascular" },
      countDeps(
        { 2021: 100, 2022: 150, 2023: 200 },
        { 2021: 20, 2022: 30, 2023: 40 },
        [2021, 2022, 2023]
      )
    ))!;
    expect(trend.totalPublications).toBe(450);
    expect(trend.totalTrials).toBe(90);
    expect(trend.maturity).toBe("established"); // 540 combined >= 500
    expect(trend.publications).toHaveLength(3);
  });

  it("classifies a small, recent topic as emerging", async () => {
    const trend = (await evidenceVolumeTrend(
      { topic: "novel target xyz" },
      countDeps(
        { 2021: 2, 2022: 8, 2023: 12, 2024: 18 },
        { 2021: 0, 2022: 1, 2023: 3, 2024: 6 },
        [2021, 2022, 2023, 2024]
      )
    ))!;
    // combined total = 42+10 = ... pubs 40, trials 10 => 50 <= 60; recent (2022-24)
    // heavily weighted -> emerging.
    expect(trend.totalPublications).toBe(40);
    expect(trend.totalTrials).toBe(10);
    expect(trend.maturity).toBe("emerging");
  });

  it("treats a null/failed year count as 0 (honest, never inflated)", async () => {
    const trend = (await evidenceVolumeTrend(
      { topic: "x" },
      countDeps({ 2022: null, 2023: 10 }, { 2022: null, 2023: null }, [2022, 2023])
    ))!;
    expect(trend.publications.find((p) => p.year === 2022)!.count).toBe(0);
    expect(trend.totalTrials).toBe(0);
    expect(trend.totalPublications).toBe(10);
  });

  it("returns null for a blank topic", async () => {
    expect(
      await evidenceVolumeTrend({ topic: "   " }, countDeps({}, {}, [2023]))
    ).toBeNull();
  });
});

describe("rweProfile — combine signals + deterministic summary", () => {
  const aeDeps: AdverseEventTrendDeps = {
    fetchYearly2x2: fetcherFrom(RISING_TABLES),
    years: [2021, 2022, 2023, 2024],
  };
  const volDeps: EvidenceVolumeTrendDeps = {
    fetchPublicationCount: vi.fn(async () => 200),
    fetchTrialStartCount: vi.fn(async () => 50),
    years: [2021, 2022, 2023],
  };

  it("computes both signals when inputs + deps are present", async () => {
    const profile = await rweProfile(
      { drug: "drugx", event: "myopathy", topic: "drugx safety" },
      { adverseEvent: aeDeps, evidenceVolume: volDeps }
    );
    expect(RweProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile.adverseEventTrend!.direction).toBe("rising");
    expect(profile.evidenceVolumeTrend!.maturity).toBe("established");
    expect(profile.summary).toContain("rising");
    expect(profile.summary).toContain("established");
  });

  it("omits the AE trend when event is missing (null, not fabricated)", async () => {
    const profile = await rweProfile(
      { topic: "drugx safety" },
      { adverseEvent: aeDeps, evidenceVolume: volDeps }
    );
    expect(profile.adverseEventTrend).toBeNull();
    expect(profile.evidenceVolumeTrend).not.toBeNull();
  });

  it("omits the volume trend when topic is missing", async () => {
    const profile = await rweProfile(
      { drug: "drugx", event: "myopathy" },
      { adverseEvent: aeDeps, evidenceVolume: volDeps }
    );
    expect(profile.evidenceVolumeTrend).toBeNull();
    expect(profile.adverseEventTrend).not.toBeNull();
  });

  it("summary is honest-empty when nothing can be computed", () => {
    expect(buildSummary(null, null)).toContain("No RWE signal");
  });
});

describe("RweRequestSchema — boundary validation", () => {
  it("accepts topic alone", () => {
    expect(RweRequestSchema.safeParse({ topic: "psoriasis biologics" }).success).toBe(true);
  });

  it("accepts drug + event", () => {
    expect(
      RweRequestSchema.safeParse({ drug: "atorvastatin", event: "rhabdomyolysis" }).success
    ).toBe(true);
  });

  it("rejects drug alone (no 2x2 possible without an event)", () => {
    expect(RweRequestSchema.safeParse({ drug: "atorvastatin" }).success).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(RweRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("defaultYears — pure sampling window", () => {
  it("produces an ascending inclusive span ending at endYear", () => {
    expect(defaultYears(4, 2024)).toEqual([2021, 2022, 2023, 2024]);
  });
});

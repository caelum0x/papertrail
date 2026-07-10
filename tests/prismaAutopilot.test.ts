import { describe, it, expect, vi } from "vitest";
import {
  runPrismaAutopilot,
  type AutopilotDeps,
} from "../lib/prisma/autopilot";
import type { SourceCandidate } from "../lib/schemas";
import type { PaperExtractResult } from "../lib/extraction/schemas";
import type { RankedRecord } from "../lib/screening/schemas";
import type { EvidencePipelineResult } from "../lib/evidencePipeline";

// Offline oracle: drive the WHOLE PRISMA flow (identify → screen → extract → synthesise)
// with deterministic stubs for every network/DB/Claude dependency. No pool is touched —
// a bare {} stands in for the Pool because the injected deps never call it.

const pool = {} as never;

// Two cached sources: one gets screened IN (relevance above threshold), one OUT.
const includedSource: SourceCandidate = {
  id: "11111111-1111-1111-1111-111111111111",
  source_type: "clinicaltrials",
  external_id: "NCT00000001",
  title: "Included Trial",
  raw_text: "Randomized trial; primary endpoint reduced (HR 0.75, 95% CI 0.65-0.87).",
  url: "https://example.test/nct1",
  phase: null,
  enrollment_count: null,
  registered_results: null,
  similarity: 1,
} as unknown as SourceCandidate;

const excludedSource: SourceCandidate = {
  id: "22222222-2222-2222-2222-222222222222",
  source_type: "pubmed",
  external_id: "PM2",
  title: "Off-topic Paper",
  raw_text: "An unrelated observational study of something else entirely.",
  url: "https://example.test/pm2",
  phase: null,
  enrollment_count: null,
  registered_results: null,
  similarity: 1,
} as unknown as SourceCandidate;

function stubExtraction(id: string, title: string): PaperExtractResult {
  return {
    pico: { population: "adults", intervention: "drug", comparator: "placebo", outcomes: ["primary"] },
    endpoints: [],
    effects: [
      {
        endpoint: "primary",
        measure: "HR",
        claimed_point: 0.75,
        claimed_ci_low: 0.65,
        claimed_ci_high: 0.87,
        is_percent: false,
        quote: "HR 0.75, 95% CI 0.65-0.87",
        grounding: { status: "exact", start: 0, end: 25 },
        reconciliation: "confirmed",
        parsed_point: 0.75,
        note: "confirmed",
      },
    ],
    ungrounded_dropped_count: 0,
    total_effects_extracted: 1,
    source: { id, title, external_id: null, source_type: null, url: null },
  };
}

function makeDeps(overrides: Partial<AutopilotDeps> = {}): AutopilotDeps {
  return {
    searchAndCache: vi.fn(async () => ({
      cachedSourceIds: [includedSource.id, excludedSource.id, includedSource.id], // dup on purpose
      fetchedCount: 2,
      reusedCount: 0,
    })),
    loadSourcesByIds: vi.fn(async (_pool, ids) =>
      [includedSource, excludedSource].filter((s) => ids.includes(s.id))
    ),
    aiRankRecords: vi.fn(async ({ records }: { records: { id: string; title: string }[] }) => {
      const ranked: RankedRecord[] = records.map((r) => ({
        id: r.id,
        title: r.title,
        relevance: r.id === includedSource.id ? 0.9 : 0.1,
        verdict: r.id === includedSource.id ? "include" : "exclude",
        rationale: "grounded rationale",
        groundingOk: true,
      }));
      return { ranked, unrankedIds: [] };
    }),
    extractPaper: vi.fn(async (_rawText, source) =>
      stubExtraction(source?.id ?? "?", source?.title ?? "?")
    ),
    runEvidencePipeline: vi.fn(async (_pool, input, opts): Promise<EvidencePipelineResult> => {
      // The autopilot must drive the pipeline over exactly the INCLUDED sources via the
      // injected retriever — assert that here by echoing what the retriever returns.
      const retrieved = opts?.retrieve ? await opts.retrieve(input.claim) : [];
      return {
        claim: input.claim,
        usedSources: retrieved.map((s: SourceCandidate) => ({
          id: s.id,
          title: s.title,
          source_type: s.source_type,
        })),
        skipped: [],
        report: {
          ok: true,
          claim: input.claim,
          // Minimal shape — only fields the autopilot passes through / the test asserts.
          pooled: {} as never,
          publicationBias: {} as never,
          certainty: { certainty: "moderate" } as never,
          verdict: {} as never,
          claimedReductionPercent: 25,
          rationale: "pooled ok",
        },
      };
    }),
    ...overrides,
  };
}

describe("runPrismaAutopilot", () => {
  it("runs the full PRISMA flow: identify → dedupe → screen → extract → synthesise", async () => {
    const deps = makeDeps();
    const result = await runPrismaAutopilot(
      pool,
      { question: "Does the drug reduce the primary endpoint?", criteria: ["RCT"] },
      deps
    );

    // Identify + dedupe: 3 ids in, 1 duplicate removed → 2 unique screened.
    expect(result.counts.identified).toBe(3);
    expect(result.counts.duplicatesRemoved).toBe(1);
    expect(result.counts.screened).toBe(2);

    // Screen: exactly one included (relevance ≥ threshold), one excluded.
    expect(result.counts.included).toBe(1);
    expect(result.counts.excluded).toBe(1);
    expect(result.screened).toHaveLength(2);
    const inc = result.screened.find((s) => s.decision === "included");
    expect(inc?.id).toBe(includedSource.id);

    // Extract: the included record yields a grounded effect.
    expect(result.counts.extractedWithEffects).toBe(1);
    expect(result.extractedRecords).toHaveLength(1);
    expect(result.extractedEffects).toHaveLength(1);
    expect(result.extractedEffects[0].effects[0].reconciliation).toBe("confirmed");

    // Synthesise: the pipeline ran over the INCLUDED source only (via the retriever),
    // and its report is passed through.
    expect(result.report?.ok).toBe(true);
    expect(result.synthesis?.usedSources.map((s) => s.id)).toEqual([includedSource.id]);
    expect(deps.extractPaper).toHaveBeenCalledTimes(1);
    expect(deps.searchAndCache).toHaveBeenCalledTimes(1);
  });

  it("uses pinned source_ids instead of searching when provided", async () => {
    const deps = makeDeps();
    await runPrismaAutopilot(
      pool,
      { question: "review these exact sources please", criteria: [], source_ids: [includedSource.id] },
      deps
    );
    // Pinned path must NOT search+cache.
    expect(deps.searchAndCache).not.toHaveBeenCalled();
    expect(deps.loadSourcesByIds).toHaveBeenCalledWith(pool, [includedSource.id]);
  });

  it("returns an honest empty flow when no reviewable sources resolve", async () => {
    const deps = makeDeps({
      loadSourcesByIds: vi.fn(async () => []),
    });
    const result = await runPrismaAutopilot(
      pool,
      { question: "a question with no cached sources", criteria: [] },
      deps
    );
    expect(result.counts.included).toBe(0);
    expect(result.report).toBeNull();
    expect(result.synthesis).toBeNull();
    expect(deps.aiRankRecords).not.toHaveBeenCalled();
  });
});

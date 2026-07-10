import { describe, it, expect } from "vitest";
import {
  fuseRankings,
  hybridSearch,
  RRF_K,
  SEMANTIC_WEIGHT,
  FULL_TEXT_WEIGHT,
  type HybridPool,
} from "../lib/retrieval/hybrid";

// Oracle tests for the native R2R HYBRID RETRIEVAL port. The load-bearing guarantee
// is that `fuseRankings` reproduces R2R's Reciprocal Rank Fusion math EXACTLY — same
// weighted formula, same fallback ranks for a doc missing from one list, same
// `* 2` window filter — so these tests pin the fused scores and ordering against
// values computed by hand, not against the implementation.
//
// RRF (R2R chunks.py::hybrid_search):
//   semantic_score  = 1 / (rrf_k + semantic_rank)
//   full_text_score = 1 / (rrf_k + full_text_rank)
//   rrf_score = (semantic_score*w_s + full_text_score*w_f) / (w_s + w_f)
// A doc absent from a list takes that list's LIMIT as its fallback rank.

// Hand-compute an rrf_score the same way the source algorithm does, for assertions.
function rrf(
  semRank: number,
  ftRank: number,
  ws = SEMANTIC_WEIGHT,
  wf = FULL_TEXT_WEIGHT,
  k = RRF_K
): number {
  const semScore = 1 / (k + semRank);
  const ftScore = 1 / (k + ftRank);
  return (semScore * ws + ftScore * wf) / (ws + wf);
}

describe("fuseRankings (RRF) — hand-computed oracle", () => {
  it("fuses two ranked lists into hand-computed scores and ordering", () => {
    // Semantic order: A, B, C   Full-text order: B, A, D
    // Ranks (1-indexed):
    //   A: sem 1, ft 2
    //   B: sem 2, ft 1
    //   C: sem 3, ft (absent -> ftLimit 3)
    //   D: sem (absent -> semLimit 3), ft 3
    const fused = fuseRankings({
      semanticIds: ["A", "B", "C"],
      fullTextIds: ["B", "A", "D"],
      semanticLimit: 3,
      fullTextLimit: 3,
    });

    const byId = new Map(fused.map((f) => [f.id, f]));

    // Exact scores against the R2R formula.
    expect(byId.get("A")!.rrfScore).toBeCloseTo(rrf(1, 2), 12);
    expect(byId.get("B")!.rrfScore).toBeCloseTo(rrf(2, 1), 12);
    expect(byId.get("C")!.rrfScore).toBeCloseTo(rrf(3, 3), 12);
    expect(byId.get("D")!.rrfScore).toBeCloseTo(rrf(3, 3), 12);

    // A and B both have {1,2} rank pairs -> identical fused score; a doc strong in
    // BOTH lists must outrank C/D that are strong in only one and fell back on the
    // other. C and D tie on {3,3} and are broken deterministically by id ("C" < "D").
    expect(fused.map((f) => f.id)).toEqual(["A", "B", "C", "D"]);

    // A vs B tie exactly (symmetric ranks under different weights only differ if the
    // rank pair differs; here A=(1,2), B=(2,1) so weighted they diverge):
    // semantic is weighted 5x, so A (better semantic rank) must score higher than B.
    expect(byId.get("A")!.rrfScore).toBeGreaterThan(byId.get("B")!.rrfScore);
  });

  it("records honest per-list provenance (null when absent from a list)", () => {
    const fused = fuseRankings({
      semanticIds: ["A", "B"],
      fullTextIds: ["B", "C"],
      semanticLimit: 2,
      fullTextLimit: 2,
    });
    const byId = new Map(fused.map((f) => [f.id, f]));

    expect(byId.get("A")).toMatchObject({ semanticRank: 1, fullTextRank: null });
    expect(byId.get("B")).toMatchObject({ semanticRank: 2, fullTextRank: 1 });
    expect(byId.get("C")).toMatchObject({ semanticRank: null, fullTextRank: 2 });
  });

  it("uses each list's LIMIT as the fallback rank for a missing doc", () => {
    // X present only in semantic at rank 1; its full-text fallback rank == fullTextLimit.
    const fused = fuseRankings({
      semanticIds: ["X"],
      fullTextIds: ["Y"],
      semanticLimit: 5,
      fullTextLimit: 8,
    });
    const byId = new Map(fused.map((f) => [f.id, f]));

    // X: sem 1, ft fallback = fullTextLimit (8)
    expect(byId.get("X")!.rrfScore).toBeCloseTo(rrf(1, 8), 12);
    // Y: sem fallback = semanticLimit (5), ft 1
    expect(byId.get("Y")!.rrfScore).toBeCloseTo(rrf(5, 1), 12);
    // X (semantic-strong, 5x weight) outranks Y (keyword-strong).
    expect(fused.map((f) => f.id)).toEqual(["X", "Y"]);
  });

  it("applies R2R's semanticLimit*2 / fullTextLimit*2 window filter", () => {
    // With limits of 2, the window is rank<=4 on each side.
    // Doc at semantic rank 5 (> 2*2) is dropped; a doc absent from fulltext falls
    // back to ftLimit=2 which is within window, so semantic-only docs survive.
    const fused = fuseRankings({
      semanticIds: ["a", "b", "c", "d", "e"], // e is rank 5 -> filtered out
      fullTextIds: [],
      semanticLimit: 2,
      fullTextLimit: 2,
    });
    const ids = fused.map((f) => f.id);
    // ranks 1..4 survive (<= semanticLimit*2 = 4); rank 5 ("e") is filtered.
    expect(ids).toContain("a");
    expect(ids).toContain("d");
    expect(ids).not.toContain("e");
  });

  it("respects injected weights and k (deterministic override of R2R defaults)", () => {
    // Equal weights + k=0 -> pure 1/rank average; makes hand math trivial.
    const fused = fuseRankings({
      semanticIds: ["p", "q"],
      fullTextIds: ["q", "p"],
      semanticLimit: 2,
      fullTextLimit: 2,
      rrfK: 0,
      semanticWeight: 1,
      fullTextWeight: 1,
    });
    const byId = new Map(fused.map((f) => [f.id, f]));
    // p: sem 1, ft 2 -> (1/1 + 1/2)/2 = 0.75 ; q: sem 2, ft 1 -> same 0.75
    expect(byId.get("p")!.rrfScore).toBeCloseTo(0.75, 12);
    expect(byId.get("q")!.rrfScore).toBeCloseTo(0.75, 12);
    // Exact tie -> deterministic id-ascending order.
    expect(fused.map((f) => f.id)).toEqual(["p", "q"]);
  });

  it("dedupes repeated ids within a list, keeping the best (first) rank", () => {
    const fused = fuseRankings({
      semanticIds: ["A", "A", "B"], // duplicate A; first occurrence (rank 1) wins
      fullTextIds: ["B"],
      semanticLimit: 3,
      fullTextLimit: 3,
    });
    const byId = new Map(fused.map((f) => [f.id, f]));
    expect(byId.get("A")!.semanticRank).toBe(1);
    // B: sem rank 3 (third position, not 2, because dup A held position 2)
    expect(byId.get("B")!.semanticRank).toBe(3);
  });
});

// --- hybridSearch integration over an INJECTED fake pool + embedder (offline) ---

// A tiny fake Postgres that returns canned rows depending on which ranker SQL runs.
// The semantic query orders by `<=>`; the keyword query uses ts_rank/ilike. We
// discriminate on a marker substring in the SQL so one fake serves both rankers.
function makePool(rows: {
  semantic: Array<Record<string, unknown>>;
  keyword: Array<Record<string, unknown>>;
}): HybridPool {
  return {
    async query(sql: string) {
      if (sql.includes("embedding <=>")) return { rows: rows.semantic };
      if (sql.includes("ts_rank")) return { rows: rows.keyword };
      return { rows: [] }; // graph expansion etc.
    },
  };
}

function srcRow(id: string, score: number): Record<string, unknown> {
  return {
    id,
    source_type: "pubmed",
    external_id: `PMID:${id}`,
    title: `Title ${id}`,
    raw_text: `Body text for source ${id}`,
    url: `https://example.org/${id}`,
    phase: null,
    enrollment_count: null,
    registered_results: null,
    similarity: score,
    rank: score,
  };
}

describe("hybridSearch (injected pool + embed) — end-to-end fusion", () => {
  const fakeEmbed = async () => [0.1, 0.2, 0.3];

  it("fuses the two mocked ranker outputs and orders by RRF score", async () => {
    const pool = makePool({
      // Semantic order: s1, s2, s3
      semantic: [srcRow("s1", 0.9), srcRow("s2", 0.8), srcRow("s3", 0.7)],
      // Keyword order: s2, s1, s4
      keyword: [srcRow("s2", 5), srcRow("s1", 4), srcRow("s4", 3)],
    });

    const hits = await hybridSearch("empagliflozin heart failure", {
      pool,
      embed: fakeEmbed,
      semanticLimit: 3,
      fullTextLimit: 3,
    });

    const ids = hits.map((h) => h.id);
    // s1 (sem1/ft2) and s2 (sem2/ft1) are the dual-list hits; semantic weight 5x
    // lifts s1 above s2. s3 (sem3, ft-absent) and s4 (ft3, sem-absent) trail.
    expect(ids.slice(0, 2)).toEqual(["s1", "s2"]);
    expect(ids).toContain("s3");
    expect(ids).toContain("s4");

    const s1 = hits.find((h) => h.id === "s1")!;
    expect(s1.rrfScore).toBeCloseTo(rrf(1, 2), 12);
    expect(s1.semanticRank).toBe(1);
    expect(s1.fullTextRank).toBe(2);
    expect(s1.graphExpanded).toBe(false);
  });

  it("honors finalLimit to cap the fused result set", async () => {
    const pool = makePool({
      semantic: [srcRow("s1", 0.9), srcRow("s2", 0.8), srcRow("s3", 0.7)],
      keyword: [srcRow("s2", 5), srcRow("s1", 4)],
    });
    const hits = await hybridSearch("q", {
      pool,
      embed: fakeEmbed,
      semanticLimit: 3,
      fullTextLimit: 3,
      finalLimit: 2,
    });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.id)).toEqual(["s1", "s2"]);
  });

  it("rejects an empty query", async () => {
    await expect(
      hybridSearch("   ", { pool: makePool({ semantic: [], keyword: [] }), embed: fakeEmbed })
    ).rejects.toThrow(/non-empty/);
  });

  it("returns an empty list when neither ranker matches", async () => {
    const hits = await hybridSearch("no matches here", {
      pool: makePool({ semantic: [], keyword: [] }),
      embed: fakeEmbed,
    });
    expect(hits).toEqual([]);
  });
});

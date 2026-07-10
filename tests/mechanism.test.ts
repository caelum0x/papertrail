import { describe, it, expect } from "vitest";
import {
  assembleMechanisms,
  combineBelief,
  type MechanismDeps,
} from "../lib/mechanism/assemble";
import {
  SOURCE_TIER_RELIABILITY,
  type GroundedEvidence,
  type RawMechanismStatement,
} from "../lib/mechanism/schemas";
import type { KgPool } from "../lib/kg/repository";

// ---------------------------------------------------------------------------
// In-memory KG pool fake — emulates ONLY the upsertNode / upsertEdge statements the
// repository issues, over Maps. Records every persisted edge so tests can assert what
// was written. Deterministic, fully offline.
// ---------------------------------------------------------------------------

interface CapturedEdge {
  subject_id: string;
  predicate: string;
  object_id: string;
  provenance: unknown;
}

function createMemoryPool(): { pool: KgPool; edges: CapturedEdge[] } {
  const nodeKey = new Map<string, string>(); // `${type}::${normId}` -> id
  const edges: CapturedEdge[] = [];
  let seq = 0;
  const nextId = () => `aaaaaaaa-0000-0000-0000-${(++seq).toString().padStart(12, "0")}`;

  const pool: KgPool = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      if (sql.includes("insert into kg_nodes")) {
        const [entity_type, name, normalized_id] = params as string[];
        const k = `${entity_type}::${normalized_id}`;
        let id = nodeKey.get(k);
        if (!id) {
          id = nextId();
          nodeKey.set(k, id);
        }
        return {
          rows: [{ id, entity_type, name, normalized_id }],
        };
      }
      if (sql.includes("insert into kg_edges")) {
        const [subject_id, predicate, object_id, provenanceJson] = params as [
          string,
          string,
          string,
          string,
        ];
        const provenance = JSON.parse(provenanceJson);
        edges.push({ subject_id, predicate, object_id, provenance });
        return {
          rows: [
            {
              id: nextId(),
              subject_id,
              predicate,
              object_id,
              provenance,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  return { pool, edges };
}

function ev(tier: GroundedEvidence["tier"], quote = "q"): GroundedEvidence {
  return { quote, tier, grounding: { status: "exact", start: 0, end: 1 } };
}

// Build an extractor stub that always returns the given candidates.
function extractStub(candidates: RawMechanismStatement[]): MechanismDeps {
  return { extract: async () => candidates };
}

describe("combineBelief — deterministic INDRA belief combination", () => {
  it("is 0 for no evidence", () => {
    expect(combineBelief([])).toBe(0);
  });

  it("single evidence yields that tier's reliability", () => {
    // belief = 1 - (1 - r) = r
    expect(combineBelief([ev("abstract")])).toBeCloseTo(SOURCE_TIER_RELIABILITY.abstract, 10);
    expect(combineBelief([ev("curated_database")])).toBeCloseTo(
      SOURCE_TIER_RELIABILITY.curated_database,
      10
    );
  });

  it("two equal-tier evidences combine as 1 - prod(1 - r)", () => {
    const r = SOURCE_TIER_RELIABILITY.abstract; // 0.65
    const expected = 1 - (1 - r) * (1 - r); // 1 - 0.35^2 = 0.8775
    expect(combineBelief([ev("abstract"), ev("abstract", "q2")])).toBeCloseTo(expected, 10);
  });

  it("mixed tiers multiply their incorrectness factors", () => {
    const ra = SOURCE_TIER_RELIABILITY.abstract; // 0.65
    const rc = SOURCE_TIER_RELIABILITY.curated_database; // 0.9
    const expected = 1 - (1 - ra) * (1 - rc); // 1 - 0.35*0.1 = 0.965
    expect(combineBelief([ev("abstract"), ev("curated_database", "q2")])).toBeCloseTo(
      expected,
      10
    );
  });

  it("more corroborating evidence never decreases belief", () => {
    const one = combineBelief([ev("preprint")]);
    const two = combineBelief([ev("preprint"), ev("preprint", "q2")]);
    expect(two).toBeGreaterThan(one);
  });
});

describe("assembleMechanisms — grounding drop over mocks", () => {
  const TEXT =
    "Sorafenib inhibits BRAF in the pathway. BRAF phosphorylates MEK downstream of the receptor.";

  it("drops candidates whose evidenceQuote is not a substring of the source", async () => {
    const candidates: RawMechanismStatement[] = [
      // groundable — verbatim substring present
      { subj: "Sorafenib", relation: "inhibits", obj: "BRAF", evidenceQuote: "Sorafenib inhibits BRAF" },
      // ungroundable — this exact string is NOT in the source
      { subj: "BRAF", relation: "activates", obj: "ERK", evidenceQuote: "BRAF activates ERK strongly" },
    ];
    const { pool, edges } = createMemoryPool();
    const result = await assembleMechanisms({ text: TEXT }, pool, extractStub(candidates));

    expect(result.groundingDroppedCount).toBe(1);
    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].subj).toBe("Sorafenib");
    // one edge persisted for the single grounded statement
    expect(edges).toHaveLength(1);
    expect(result.edgesUpserted).toBe(1);
  });

  it("grounds to the VERBATIM source substring, not the model paraphrase", async () => {
    // Model quote differs only by whitespace; grounding recovers the exact source text.
    const candidates: RawMechanismStatement[] = [
      {
        subj: "BRAF",
        relation: "phosphorylates",
        obj: "MEK",
        evidenceQuote: "BRAF   phosphorylates   MEK",
      },
    ];
    const { pool } = createMemoryPool();
    const result = await assembleMechanisms({ text: TEXT }, pool, extractStub(candidates));

    expect(result.statements).toHaveLength(1);
    expect(result.statements[0].evidence[0].quote).toBe("BRAF phosphorylates MEK");
    expect(result.statements[0].evidence[0].grounding.status).toBe("approximate");
  });

  it("returns an honest empty result when nothing extracts", async () => {
    const { pool } = createMemoryPool();
    const result = await assembleMechanisms({ text: TEXT }, pool, extractStub([]));
    expect(result).toEqual({ statements: [], groundingDroppedCount: 0, edgesUpserted: 0 });
  });

  it("degrades to empty (no throw) when the extractor fails", async () => {
    const failingDeps: MechanismDeps = {
      extract: async () => {
        throw new Error("LLM down");
      },
    };
    const { pool } = createMemoryPool();
    const result = await assembleMechanisms({ text: TEXT }, pool, failingDeps);
    expect(result.statements).toHaveLength(0);
    expect(result.edgesUpserted).toBe(0);
  });
});

describe("assembleMechanisms — assembly (preassembly) + belief", () => {
  const TEXT = "Sorafenib inhibits BRAF. sorafenib inhibits braf again in a second study.";

  it("de-duplicates same (subj, relation, obj) triple case-insensitively and merges evidence", async () => {
    const candidates: RawMechanismStatement[] = [
      { subj: "Sorafenib", relation: "inhibits", obj: "BRAF", evidenceQuote: "Sorafenib inhibits BRAF" },
      { subj: "sorafenib", relation: "inhibits", obj: "braf", evidenceQuote: "sorafenib inhibits braf again in a second study" },
    ];
    const { pool, edges } = createMemoryPool();
    const result = await assembleMechanisms(
      { text: TEXT, tier: "full_text" },
      pool,
      extractStub(candidates)
    );

    // Collapsed to ONE statement with TWO evidences.
    expect(result.statements).toHaveLength(1);
    const stmt = result.statements[0];
    expect(stmt.evidence).toHaveLength(2);

    // belief = 1 - (1 - r)^2 for two full_text evidences.
    const r = SOURCE_TIER_RELIABILITY.full_text;
    expect(stmt.belief).toBeCloseTo(1 - (1 - r) * (1 - r), 10);

    // ONE KG edge persisted, under the closest KG predicate, with the mechanism relation
    // preserved in provenance and the deterministic belief as the score.
    expect(edges).toHaveLength(1);
    expect(edges[0].predicate).toBe("targets");
    const prov = edges[0].provenance as { evidenceRef: string; score: number; source: string };
    expect(prov.source).toBe("mechanism_assembly");
    expect(prov.evidenceRef).toContain("relation:inhibits");
    expect(prov.evidenceRef).toContain("evidence:2");
    expect(prov.score).toBeCloseTo(stmt.belief, 10);
  });

  it("assembles without a pool (edgesUpserted = 0) but still returns scored statements", async () => {
    const candidates: RawMechanismStatement[] = [
      { subj: "Sorafenib", relation: "inhibits", obj: "BRAF", evidenceQuote: "Sorafenib inhibits BRAF" },
    ];
    const result = await assembleMechanisms({ text: TEXT }, null, extractStub(candidates));
    expect(result.statements).toHaveLength(1);
    expect(result.edgesUpserted).toBe(0);
  });

  it("orders statements by descending belief", async () => {
    const text =
      "A activates B. C inhibits D. C inhibits D confirmed in a replication cohort.";
    const candidates: RawMechanismStatement[] = [
      { subj: "A", relation: "activates", obj: "B", evidenceQuote: "A activates B" },
      { subj: "C", relation: "inhibits", obj: "D", evidenceQuote: "C inhibits D" },
      { subj: "C", relation: "inhibits", obj: "D", evidenceQuote: "C inhibits D confirmed in a replication cohort" },
    ];
    const { pool } = createMemoryPool();
    const result = await assembleMechanisms({ text, tier: "abstract" }, pool, extractStub(candidates));
    expect(result.statements).toHaveLength(2);
    // C-inhibits-D has 2 evidences -> higher belief -> comes first.
    expect(result.statements[0].subj).toBe("C");
    expect(result.statements[0].belief).toBeGreaterThan(result.statements[1].belief);
  });
});

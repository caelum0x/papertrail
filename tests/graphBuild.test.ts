import { describe, it, expect } from "vitest";
import { buildEvidenceGraph } from "../lib/graph/build";
import type { SourceExtraction } from "../lib/graph/schemas";

// Oracle test for the pure aggregation engine — NO LLM, NO DB. Two sources assert the
// SAME (subject, predicate, object) triple with different grounded sentences: the graph
// must merge them into ONE edge that accumulates BOTH provenance entries, merge shared
// entities into single nodes, compute degree, and carry the dropped-relation count.

const sourceA: SourceExtraction = {
  source_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  entities: [
    { name: "Sacubitril/Valsartan", type: "drug" },
    { name: "cardiovascular death", type: "outcome" },
    { name: "hypotension", type: "outcome" },
  ],
  relations: [
    {
      subject: "Sacubitril/Valsartan",
      subject_type: "drug",
      predicate: "reduces_risk_of",
      object: "cardiovascular death",
      object_type: "outcome",
      source_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      grounded_sentence: "sacubitril/valsartan reduced the risk of cardiovascular death.",
      grounding: { status: "exact", start: 10, end: 71 },
    },
    {
      subject: "Sacubitril/Valsartan",
      subject_type: "drug",
      predicate: "increases_risk_of",
      object: "hypotension",
      object_type: "outcome",
      source_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      grounded_sentence: "Treatment was associated with hypotension.",
      grounding: { status: "exact", start: 100, end: 142 },
    },
  ],
  dropped_relations: 1,
};

const sourceB: SourceExtraction = {
  source_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  // Note: same entity name with different casing must merge with source A's node.
  entities: [
    { name: "sacubitril/valsartan", type: "drug" },
    { name: "cardiovascular death", type: "outcome" },
  ],
  relations: [
    {
      subject: "sacubitril/valsartan",
      subject_type: "drug",
      predicate: "reduces_risk_of",
      object: "cardiovascular death",
      object_type: "outcome",
      source_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      grounded_sentence: "the drug lowered cardiovascular mortality significantly.",
      grounding: { status: "approximate", start: 5, end: 60 },
    },
  ],
  dropped_relations: 2,
};

describe("buildEvidenceGraph", () => {
  it("merges duplicate triples across sources into one edge with all provenance", () => {
    const graph = buildEvidenceGraph([sourceA, sourceB]);

    // The reduces_risk_of edge appears in both sources → one edge, two provenance.
    const reduceEdge = graph.edges.find((e) => e.predicate === "reduces_risk_of");
    expect(reduceEdge).toBeDefined();
    expect(reduceEdge?.provenance).toHaveLength(2);
    expect(reduceEdge?.provenance.map((p) => p.source_id).sort()).toEqual([
      sourceA.source_id,
      sourceB.source_id,
    ]);

    // Two distinct edges total (reduces_risk_of, increases_risk_of).
    expect(graph.edges).toHaveLength(2);
  });

  it("merges same-name entities (case-insensitive) into one node and computes degree", () => {
    const graph = buildEvidenceGraph([sourceA, sourceB]);

    const drugNodes = graph.nodes.filter((n) => n.type === "drug");
    expect(drugNodes).toHaveLength(1);
    // The drug participates in both edges → degree 2.
    expect(drugNodes[0].degree).toBe(2);

    // 3 unique entities: drug, cardiovascular death, hypotension.
    expect(graph.nodes).toHaveLength(3);
  });

  it("reports grounded and dropped relation counts in stats", () => {
    const graph = buildEvidenceGraph([sourceA, sourceB]);
    expect(graph.stats.grounded_relation_count).toBe(3); // 2 + 1 grounded relations
    expect(graph.stats.dropped_relation_count).toBe(3); // 1 + 2 dropped upstream
    expect(graph.stats.source_count).toBe(2);
    expect(graph.stats.edge_count).toBe(2);
    expect(graph.stats.node_count).toBe(3);
  });

  it("is a pure function — does not mutate its inputs", () => {
    const before = JSON.stringify([sourceA, sourceB]);
    buildEvidenceGraph([sourceA, sourceB]);
    expect(JSON.stringify([sourceA, sourceB])).toBe(before);
  });
});

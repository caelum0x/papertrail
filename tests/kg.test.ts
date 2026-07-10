import { describe, it, expect } from "vitest";
import { ingestClaimGraph, queryPath, type KgGraphDeps } from "../lib/kg/graph";
import {
  upsertNode,
  upsertEdge,
  neighbors,
  findPaths,
  getNodeByNormalizedId,
  type KgPool,
} from "../lib/kg/repository";
import type { BioEntity } from "../lib/bio/entities.schemas";
import type { GeneticAssociationResult } from "../lib/bio/genetics.schemas";
import type { TargetDiseaseEvidence } from "../lib/bio/targets.schemas";

// ---------------------------------------------------------------------------
// In-memory Postgres fake. Emulates ONLY the specific parameterized statements the
// repository issues (matched by a stable substring), over Maps that stand in for the
// kg_nodes / kg_edges tables. Deterministic and fully offline — no pg, no network.
// ---------------------------------------------------------------------------

interface NodeRow {
  id: string;
  entity_type: string;
  name: string;
  normalized_id: string;
}
interface EdgeRow {
  id: string;
  subject_id: string;
  predicate: string;
  object_id: string;
  provenance: unknown;
}

function createMemoryPool(): KgPool {
  const nodes = new Map<string, NodeRow>(); // id -> row
  const nodeKey = new Map<string, string>(); // `${type}::${normId}` -> id
  const edges = new Map<string, EdgeRow>(); // id -> row
  const edgeKey = new Map<string, string>(); // `${subj}::${pred}::${obj}` -> id
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${(++seq).toString().padStart(4, "0")}-0000-0000-000000000000`;

  const query = async (sql: string, params: readonly unknown[] = []) => {
    // upsertNode
    if (sql.includes("insert into kg_nodes")) {
      const [entity_type, name, normalized_id] = params as string[];
      const k = `${entity_type}::${normalized_id}`;
      let id = nodeKey.get(k);
      if (id) {
        const row = nodes.get(id)!;
        nodes.set(id, { ...row, name }); // on-conflict refreshes name
      } else {
        id = uuidLike(nextId("aaaa"));
        nodeKey.set(k, id);
        nodes.set(id, { id, entity_type, name, normalized_id });
      }
      return { rows: [nodes.get(id)!] };
    }

    // upsertEdge
    if (sql.includes("insert into kg_edges")) {
      const [subject_id, predicate, object_id, provenanceJson] = params as string[];
      const k = `${subject_id}::${predicate}::${object_id}`;
      let id = edgeKey.get(k);
      const provenance = JSON.parse(provenanceJson);
      if (id) {
        const row = edges.get(id)!;
        edges.set(id, { ...row, provenance });
      } else {
        id = uuidLike(nextId("bbbb"));
        edgeKey.set(k, id);
        edges.set(id, { id, subject_id, predicate, object_id, provenance });
      }
      return { rows: [edges.get(id)!] };
    }

    // neighbors (join select) — must be checked before the plain node selects
    if (sql.includes("from kg_edges e") && sql.includes("join kg_nodes n")) {
      const [subjectId] = params as string[];
      const rows = [...edges.values()]
        .filter((e) => e.subject_id === subjectId)
        .map((e) => {
          const n = nodes.get(e.object_id)!;
          return {
            edge_id: e.id,
            subject_id: e.subject_id,
            predicate: e.predicate,
            object_id: e.object_id,
            provenance: e.provenance,
            n_id: n.id,
            n_entity_type: n.entity_type,
            n_name: n.name,
            n_normalized_id: n.normalized_id,
          };
        });
      return { rows };
    }

    // getNodeByNormalizedId
    if (sql.includes("from kg_nodes") && sql.includes("where normalized_id = $1")) {
      const [normId] = params as string[];
      const row = [...nodes.values()].find((n) => n.normalized_id === normId);
      return { rows: row ? [row] : [] };
    }

    // getNodeById
    if (sql.includes("from kg_nodes") && sql.includes("where id = $1")) {
      const [id] = params as string[];
      const row = nodes.get(id);
      return { rows: row ? [row] : [] };
    }

    return { rows: [] };
  };

  return { query };
}

// Coerce our synthetic ids into a real UUID string shape so KgNodeSchema's .uuid()
// validation passes. The prefix/seq keep them unique + stable within a test.
function uuidLike(seed: string): string {
  const hex = Buffer.from(seed).toString("hex").padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(
    17,
    20
  )}-${hex.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// Mocked bio deps. annotate() grounds a fixed set of entities; geneticAssociation()
// returns a genome-wide-significant verdict for the gene→disease pair;
// targetDisease() returns a scored association so the drug→gene / drug→disease edges
// are derived. Everything deterministic — no network.
// ---------------------------------------------------------------------------

const GENE: BioEntity = {
  text: "PCSK9",
  type: "gene",
  normalizedId: "NCBI Gene:255738",
  offsets: [],
};
const DISEASE: BioEntity = {
  text: "hypercholesterolemia",
  type: "disease",
  normalizedId: "MESH:D006937",
  offsets: [],
};
const DRUG: BioEntity = {
  text: "evolocumab",
  type: "chemical",
  normalizedId: "MESH:C000588999",
  offsets: [],
};

function mockDeps(overrides: Partial<KgGraphDeps> = {}): KgGraphDeps {
  return {
    annotate: async () => [{ entities: [GENE, DISEASE, DRUG] }],
    geneticAssociation: async (): Promise<GeneticAssociationResult> => ({
      verdict: "genome_wide_significant",
      disease: "hypercholesterolemia",
      gene: "PCSK9",
      variant: null,
      minPValue: 1e-20,
      thresholds: { genomeWideSignificant: 5e-8, suggestive: 1e-5 },
      supporting: { gwas: [], clinvar: [] },
      rationale:
        "A disease-matched GWAS association reached p=1.00e-20 ≤ 5e-8 (genome-wide significance).",
    }),
    targetDisease: async (): Promise<TargetDiseaseEvidence> => ({
      found: true,
      target: {
        querySymbol: "evolocumab",
        ensemblId: "ENSG00000169174",
        approvedSymbol: "PCSK9",
        approvedName: "proprotein convertase subtilisin/kexin type 9",
      },
      disease: { queryName: "hypercholesterolemia", efoId: "EFO_0004911", name: "hypercholesterolemia" },
      overallScore: 0.82,
      datatypeScores: {
        genetic_association: 0.7,
        known_drug: 0.9,
        literature: 0.5,
        animal_model: null,
      },
      knownDrugs: [
        {
          drugId: "CHEMBL3833319",
          drugName: "EVOLOCUMAB",
          mechanismOfAction: "PCSK9 inhibitor",
          phase: 4,
          status: null,
        },
      ],
      tractability: [],
    }),
    ...overrides,
  };
}

// ===========================================================================

describe("kg repository", () => {
  it("upserts a node idempotently on (entity_type, normalized_id)", async () => {
    const pool = createMemoryPool();
    const a = await upsertNode(pool, {
      entityType: "gene",
      name: "PCSK9",
      normalizedId: "NCBI Gene:255738",
    });
    const b = await upsertNode(pool, {
      entityType: "gene",
      name: "PCSK9 (updated)",
      normalizedId: "NCBI Gene:255738",
    });
    expect(a.id).toBe(b.id); // same node, not a duplicate
    expect(b.name).toBe("PCSK9 (updated)"); // name refreshed on conflict
  });

  it("upserts an edge carrying provenance and refreshes it idempotently", async () => {
    const pool = createMemoryPool();
    const gene = await upsertNode(pool, {
      entityType: "gene",
      name: "PCSK9",
      normalizedId: "NCBI Gene:255738",
    });
    const disease = await upsertNode(pool, {
      entityType: "disease",
      name: "hypercholesterolemia",
      normalizedId: "MESH:D006937",
    });

    const provenance = {
      source: "genetic_association",
      evidenceRef: "verdict:genome_wide_significant",
      groundedQuote: "genome-wide significant association",
      score: 0.95,
    };
    const e1 = await upsertEdge(pool, {
      subjectId: gene.id,
      predicate: "associates_with",
      objectId: disease.id,
      provenance,
    });
    const e2 = await upsertEdge(pool, {
      subjectId: gene.id,
      predicate: "associates_with",
      objectId: disease.id,
      provenance: { ...provenance, score: 0.9 },
    });
    expect(e1.id).toBe(e2.id); // same triple, one edge
    expect(e2.provenance.score).toBe(0.9); // provenance refreshed
    expect(e2.provenance.source).toBe("genetic_association");
  });

  it("neighbors returns outbound edges paired with their object node", async () => {
    const pool = createMemoryPool();
    const drug = await upsertNode(pool, { entityType: "drug", name: "evolocumab", normalizedId: "MESH:C1" });
    const gene = await upsertNode(pool, { entityType: "gene", name: "PCSK9", normalizedId: "NCBI Gene:255738" });
    await upsertEdge(pool, {
      subjectId: drug.id,
      predicate: "targets",
      objectId: gene.id,
      provenance: { source: "open_targets", evidenceRef: "x", groundedQuote: "q", score: 0.9 },
    });

    const ns = await neighbors(pool, drug.id);
    expect(ns).toHaveLength(1);
    expect(ns[0].node.normalizedId).toBe("NCBI Gene:255738");
    expect(ns[0].edge.predicate).toBe("targets");
  });

  it("findPaths returns a 2-hop provenance-annotated path", async () => {
    const pool = createMemoryPool();
    const drug = await upsertNode(pool, { entityType: "drug", name: "evolocumab", normalizedId: "MESH:C1" });
    const gene = await upsertNode(pool, { entityType: "gene", name: "PCSK9", normalizedId: "NCBI Gene:255738" });
    const disease = await upsertNode(pool, {
      entityType: "disease",
      name: "hypercholesterolemia",
      normalizedId: "MESH:D006937",
    });
    await upsertEdge(pool, {
      subjectId: drug.id,
      predicate: "targets",
      objectId: gene.id,
      provenance: { source: "open_targets", evidenceRef: "kd", groundedQuote: "targets", score: 0.9 },
    });
    await upsertEdge(pool, {
      subjectId: gene.id,
      predicate: "associates_with",
      objectId: disease.id,
      provenance: { source: "genetic_association", evidenceRef: "gwas", groundedQuote: "assoc", score: 0.95 },
    });

    const path = await findPaths(pool, drug.id, disease.id, 3);
    expect(path).not.toBeNull();
    expect(path!.hops).toBe(2);
    expect(path!.nodes.map((n) => n.normalizedId)).toEqual([
      "MESH:C1",
      "NCBI Gene:255738",
      "MESH:D006937",
    ]);
    expect(path!.edges.map((e) => e.predicate)).toEqual(["targets", "associates_with"]);
    // Provenance travels with the path.
    expect(path!.edges[0].provenance.source).toBe("open_targets");
    expect(path!.edges[1].provenance.score).toBe(0.95);
  });

  it("findPaths returns null when no path exists within the hop budget", async () => {
    const pool = createMemoryPool();
    const a = await upsertNode(pool, { entityType: "drug", name: "a", normalizedId: "MESH:A" });
    const b = await upsertNode(pool, { entityType: "disease", name: "b", normalizedId: "MESH:B" });
    const path = await findPaths(pool, a.id, b.id, 3);
    expect(path).toBeNull();
  });
});

describe("kg graph ingestion", () => {
  it("ingests grounded entities + provenance-bearing edges over mocked deps", async () => {
    const pool = createMemoryPool();
    const result = await ingestClaimGraph({ text: "evolocumab inhibits PCSK9 in hypercholesterolemia" }, pool, mockDeps());

    // Nodes: gene + disease + drug (3 distinct normalized entities).
    expect(result.nodesUpserted).toBe(3);

    // Edges derived: gene→disease (genetic), drug→disease (treats), drug→gene (targets).
    const predicates = result.edges.map((e) => e.predicate).sort();
    expect(predicates).toContain("associates_with");
    expect(predicates).toContain("treats");
    expect(predicates).toContain("targets");
    expect(result.edgesUpserted).toBe(result.edges.length);

    // Every edge carries provenance with a deterministic score in [0, 1] and a
    // grounded quote — no unsourced relations.
    for (const edge of result.edges) {
      expect(edge.provenance.groundedQuote.length).toBeGreaterThan(0);
      expect(edge.provenance.score).toBeGreaterThanOrEqual(0);
      expect(edge.provenance.score).toBeLessThanOrEqual(1);
      expect(edge.provenance.source.length).toBeGreaterThan(0);
    }

    // The genetic edge's confidence is the DOCUMENTED genome-wide-significant constant.
    const geneticEdge = result.edges.find((e) => e.predicate === "associates_with")!;
    expect(geneticEdge.provenance.source).toBe("genetic_association");
    expect(geneticEdge.provenance.score).toBe(0.95);
  });

  it("does NOT persist an edge for a non-supporting genetic verdict", async () => {
    const pool = createMemoryPool();
    const deps = mockDeps({
      geneticAssociation: async () => ({
        verdict: "no_association_found",
        disease: "hypercholesterolemia",
        gene: "PCSK9",
        variant: null,
        minPValue: null,
        thresholds: { genomeWideSignificant: 5e-8, suggestive: 1e-5 },
        supporting: { gwas: [], clinvar: [] },
        rationale: "Neither source returned a disease-matched association.",
      }),
      // No Open Targets association either → no drug edges.
      targetDisease: async () => ({
        found: false,
        target: { querySymbol: "evolocumab", ensemblId: null, approvedSymbol: null, approvedName: null },
        disease: { queryName: "hypercholesterolemia", efoId: null, name: null },
        overallScore: null,
        datatypeScores: { genetic_association: null, known_drug: null, literature: null, animal_model: null },
        knownDrugs: [],
        tractability: [],
      }),
    });

    const result = await ingestClaimGraph({ text: "unrelated" }, pool, deps);
    expect(result.edges).toHaveLength(0);
    expect(result.edgesUpserted).toBe(0);
  });

  it("returns an honest empty result when grounding finds no linked entities", async () => {
    const pool = createMemoryPool();
    const result = await ingestClaimGraph({ text: "x" }, pool, mockDeps({ annotate: async () => [] }));
    expect(result).toEqual({ nodesUpserted: 0, edgesUpserted: 0, edges: [] });
  });
});

describe("kg graph path query end-to-end", () => {
  it("ingests, then returns the SHORTEST provenance-bearing path drug→disease", async () => {
    const pool = createMemoryPool();
    await ingestClaimGraph({ text: "evolocumab inhibits PCSK9 in hypercholesterolemia" }, pool, mockDeps());

    // Ingestion derives BOTH a direct drug --treats--> disease edge AND the two-hop
    // drug --targets--> gene --associates_with--> disease chain. queryPath is a
    // shortest-path walk, so it correctly returns the 1-hop direct evidence, with its
    // Open Targets provenance intact.
    const path = await queryPath("MESH:C000588999", "MESH:D006937", pool, { maxHops: 3 });
    expect(path).not.toBeNull();
    expect(path!.hops).toBe(1);
    expect(path!.edges[0].predicate).toBe("treats");
    expect(path!.edges[0].provenance.source).toBe("open_targets");
    expect(path!.nodes[0].normalizedId).toBe("MESH:C000588999");
    expect(path!.nodes[path!.nodes.length - 1].normalizedId).toBe("MESH:D006937");
  });

  it("returns the 2-hop drug→gene→disease chain when no direct edge shortcuts it", async () => {
    const pool = createMemoryPool();
    // Suppress the direct drug→disease `treats` edge (found:false) so only the
    // two-hop chain exists: drug --targets--> gene --associates_with--> disease.
    const deps = mockDeps({
      targetDisease: async () => ({
        found: false,
        target: {
          querySymbol: "evolocumab",
          ensemblId: "ENSG00000169174",
          approvedSymbol: "PCSK9",
          approvedName: "PCSK9",
        },
        disease: { queryName: "hypercholesterolemia", efoId: "EFO_0004911", name: "hypercholesterolemia" },
        overallScore: null,
        datatypeScores: { genetic_association: null, known_drug: null, literature: null, animal_model: null },
        knownDrugs: [],
        tractability: [],
      }),
    });
    // With no Open Targets treats/targets edge, the drug is isolated — so add the
    // targets edge directly to exercise the 2-hop walk over the ingested genetic edge.
    await ingestClaimGraph({ text: "evolocumab inhibits PCSK9 in hypercholesterolemia" }, pool, deps);
    // The genetic edge persisted gene + disease; the drug had no derived edge (found:false),
    // so upsert the drug node and its targets edge to the (already persisted) gene.
    const gene = await getNodeByNormalizedId(pool, "NCBI Gene:255738");
    expect(gene).toBeTruthy();
    const drug = await upsertNode(pool, {
      entityType: "drug",
      name: "evolocumab",
      normalizedId: "MESH:C000588999",
    });
    await upsertEdge(pool, {
      subjectId: drug.id,
      predicate: "targets",
      objectId: gene!.id,
      provenance: { source: "open_targets", evidenceRef: "kd", groundedQuote: "targets PCSK9", score: 0.9 },
    });

    const path = await queryPath("MESH:C000588999", "MESH:D006937", pool, { maxHops: 3 });
    expect(path).not.toBeNull();
    expect(path!.hops).toBe(2);
    expect(path!.nodes[1].entityType).toBe("gene");
    expect(path!.edges.map((e) => e.predicate)).toEqual(["targets", "associates_with"]);
    expect(path!.edges.every((e) => e.provenance.source.length > 0)).toBe(true);
  });

  it("returns null when an endpoint id is unknown to the graph", async () => {
    const pool = createMemoryPool();
    await ingestClaimGraph({ text: "evolocumab inhibits PCSK9 in hypercholesterolemia" }, pool, mockDeps());
    const path = await queryPath("MESH:C000588999", "MESH:UNKNOWN", pool, { maxHops: 3 });
    expect(path).toBeNull();
  });

  it("getNodeByNormalizedId resolves a persisted node", async () => {
    const pool = createMemoryPool();
    await ingestClaimGraph({ text: "evolocumab inhibits PCSK9 in hypercholesterolemia" }, pool, mockDeps());
    const node = await getNodeByNormalizedId(pool, "NCBI Gene:255738");
    expect(node?.entityType).toBe("gene");
    expect(node?.name).toBe("PCSK9");
  });
});

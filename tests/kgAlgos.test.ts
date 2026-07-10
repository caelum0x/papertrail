import { describe, it, expect } from "vitest";
import {
  buildSubgraph,
  commonNeighbors,
  adamicAdar,
  resourceAllocation,
  preferentialAttachment,
  predictLinks,
  type Subgraph,
} from "../lib/kg/linkPredict";
import { upsertNode, upsertEdge, type KgPool } from "../lib/kg/repository";
import type { KgNode } from "../lib/kg/schemas";
import {
  toBiolinkCategory,
  toBiolinkPredicate,
  biolinkAncestors,
  isCategoryA,
  isWellTypedTriple,
  BIOLINK_CATEGORY,
  BIOLINK_PREDICATE,
} from "../lib/kg/biolink";

// ---------------------------------------------------------------------------
// In-memory Postgres fake — the SAME shape used by tests/kg.test.ts. Emulates only the
// parameterized statements the repository issues (matched by substring) over Maps that
// stand in for kg_nodes / kg_edges. Deterministic, fully offline.
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

function uuidLike(seed: string): string {
  const hex = Buffer.from(seed).toString("hex").padEnd(32, "0").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(
    17,
    20
  )}-${hex.slice(20, 32)}`;
}

function createMemoryPool(): KgPool {
  const nodes = new Map<string, NodeRow>();
  const nodeKey = new Map<string, string>();
  const edges = new Map<string, EdgeRow>();
  const edgeKey = new Map<string, string>();
  let seq = 0;
  const nextId = (prefix: string) =>
    uuidLike(`${prefix}-${(++seq).toString().padStart(4, "0")}`);

  const query = async (sql: string, params: readonly unknown[] = []) => {
    if (sql.includes("insert into kg_nodes")) {
      const [entity_type, name, normalized_id] = params as string[];
      const k = `${entity_type}::${normalized_id}`;
      let id = nodeKey.get(k);
      if (id) {
        nodes.set(id, { ...nodes.get(id)!, name });
      } else {
        id = nextId("aaaa");
        nodeKey.set(k, id);
        nodes.set(id, { id, entity_type, name, normalized_id });
      }
      return { rows: [nodes.get(id)!] };
    }

    if (sql.includes("insert into kg_edges")) {
      const [subject_id, predicate, object_id, provenanceJson] = params as string[];
      const k = `${subject_id}::${predicate}::${object_id}`;
      let id = edgeKey.get(k);
      const provenance = JSON.parse(provenanceJson);
      if (id) {
        edges.set(id, { ...edges.get(id)!, provenance });
      } else {
        id = nextId("bbbb");
        edgeKey.set(k, id);
        edges.set(id, { id, subject_id, predicate, object_id, provenance });
      }
      return { rows: [edges.get(id)!] };
    }

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

    if (sql.includes("from kg_nodes") && sql.includes("where normalized_id = $1")) {
      const [normId] = params as string[];
      const row = [...nodes.values()].find((n) => n.normalized_id === normId);
      return { rows: row ? [row] : [] };
    }

    if (sql.includes("from kg_nodes") && sql.includes("where id = $1")) {
      const [id] = params as string[];
      const row = nodes.get(id);
      return { rows: row ? [row] : [] };
    }

    return { rows: [] };
  };

  return { query };
}

// ---------------------------------------------------------------------------
// A FIXED small graph with hand-computable topology.
//
// Directed edges (treated undirected by the scorers):
//   A -> C, A -> D, A -> E, C -> B, D -> B, D -> X, D -> Y
//
// Undirected neighbor sets and degrees:
//   Γ(A) = {C, D, E}        deg 3
//   Γ(B) = {C, D}           deg 2
//   Γ(C) = {A, B}           deg 2
//   Γ(D) = {A, B, X, Y}     deg 4
//   Γ(E) = {A}              deg 1
//   Γ(X) = {D}              deg 1
//   Γ(Y) = {D}              deg 1
//
// Shared neighbors of A and B: {C, D}. So, by hand:
//   CN(A,B) = 2
//   AA(A,B) = 1/ln(deg C) + 1/ln(deg D) = 1/ln 2 + 1/ln 4
//   RA(A,B) = 1/deg C + 1/deg D = 1/2 + 1/4 = 0.75
//   PA(A,B) = deg(A) * deg(B) = 3 * 2 = 6
//
// Every node is reachable from seed A within radius 2, so buildSubgraph([A], 2) yields
// the whole graph.
// ---------------------------------------------------------------------------

interface Fixed {
  pool: KgPool;
  sub: Subgraph;
  id: Record<string, string>;
  node: Record<string, KgNode>;
}

async function buildFixedGraph(): Promise<Fixed> {
  const pool = createMemoryPool();

  const mk = (letter: string, type: "gene" | "disease" | "drug"): Promise<KgNode> =>
    upsertNode(pool, {
      entityType: type,
      name: `node-${letter}`,
      normalizedId: `NORM:${letter}`,
    });

  // Types chosen so a subset also exercises Biolink well-typing:
  //   A = drug, B = disease (so drug -treats-> disease is well-typed),
  //   C/D/E/X/Y arbitrary intermediates.
  const A = await mk("A", "drug");
  const B = await mk("B", "disease");
  const C = await mk("C", "gene");
  const D = await mk("D", "gene");
  const E = await mk("E", "gene");
  const X = await mk("X", "gene");
  const Y = await mk("Y", "gene");

  const node = { A, B, C, D, E, X, Y };
  const id = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, v.id]));

  const prov = {
    source: "test",
    evidenceRef: "fixture",
    groundedQuote: "fixed test graph",
    score: 1,
  };
  const edge = (s: KgNode, o: KgNode) =>
    upsertEdge(pool, { subjectId: s.id, predicate: "associates_with", objectId: o.id, provenance: prov });

  await edge(A, C);
  await edge(A, D);
  await edge(A, E);
  await edge(C, B);
  await edge(D, B);
  await edge(D, X);
  await edge(D, Y);

  const sub = await buildSubgraph(pool, [A.id], 2);
  return { pool, sub, id, node };
}

// ---------------------------------------------------------------------------
// Link-prediction scorer tests — assert against hand-computed values.
// ---------------------------------------------------------------------------

describe("linkPredict topology scorers (ported from PyKEEN baselines)", () => {
  it("builds the expected undirected adjacency and degrees", async () => {
    const { sub, id } = await buildFixedGraph();
    const deg = (k: string) => sub.adjacency.get(id[k])?.size ?? 0;
    expect(deg("A")).toBe(3);
    expect(deg("B")).toBe(2);
    expect(deg("C")).toBe(2);
    expect(deg("D")).toBe(4);
    expect(deg("E")).toBe(1);
    expect(deg("X")).toBe(1);
    expect(deg("Y")).toBe(1);
  });

  it("common-neighbors(A,B) = 2", async () => {
    const { sub, id } = await buildFixedGraph();
    expect(commonNeighbors(sub, id.A, id.B)).toBe(2);
  });

  it("resource-allocation(A,B) = 1/2 + 1/4 = 0.75", async () => {
    const { sub, id } = await buildFixedGraph();
    expect(resourceAllocation(sub, id.A, id.B)).toBeCloseTo(0.75, 12);
  });

  it("Adamic-Adar(A,B) = 1/ln2 + 1/ln4", async () => {
    const { sub, id } = await buildFixedGraph();
    const expected = 1 / Math.log(2) + 1 / Math.log(4);
    expect(adamicAdar(sub, id.A, id.B)).toBeCloseTo(expected, 12);
  });

  it("preferential-attachment(A,B) = deg(A)*deg(B) = 6", async () => {
    const { sub, id } = await buildFixedGraph();
    expect(preferentialAttachment(sub, id.A, id.B)).toBe(6);
  });

  it("predictLinks ranks B first for A and never re-proposes an existing direct link", async () => {
    const { pool, node } = await buildFixedGraph();
    const preds = await predictLinks(pool, node.A, { scorer: "adamic_adar", radius: 2 });

    // B (the well-connected non-neighbor) tops the ranking.
    expect(preds[0]?.object.id).toBe(node.B.id);

    // A's existing direct neighbors (C, D, E) must never appear as predictions.
    const predictedIds = new Set(preds.map((p) => p.object.id));
    expect(predictedIds.has(node.C.id)).toBe(false);
    expect(predictedIds.has(node.D.id)).toBe(false);
    expect(predictedIds.has(node.E.id)).toBe(false);
    // No self-link.
    expect(predictedIds.has(node.A.id)).toBe(false);
  });

  it("predictLinks respects a Biolink well-typing accept filter (drug->treats->disease)", async () => {
    const { pool, node } = await buildFixedGraph();
    const preds = await predictLinks(pool, node.A, {
      scorer: "resource_allocation",
      predicate: "treats",
      radius: 2,
      accept: (s, o) => isWellTypedTriple(s, "treats", o),
    });
    // A is a drug; only disease objects (B) are well-typed for `treats`. X/Y are genes.
    expect(preds.length).toBe(1);
    expect(preds[0]?.object.id).toBe(node.B.id);
    expect(preds[0]?.score).toBeCloseTo(0.75, 12);
  });
});

// ---------------------------------------------------------------------------
// Biolink typing tests (ported from BioCypher's ontology mapping).
// ---------------------------------------------------------------------------

describe("biolink typing (ported from BioCypher ontology mapping)", () => {
  it("maps each entity type to its canonical Biolink category", () => {
    expect(toBiolinkCategory("gene")).toBe("biolink:Gene");
    expect(toBiolinkCategory("disease")).toBe("biolink:Disease");
    expect(toBiolinkCategory("chemical")).toBe("biolink:ChemicalEntity");
    expect(toBiolinkCategory("drug")).toBe("biolink:Drug");
    expect(toBiolinkCategory("variant")).toBe("biolink:SequenceVariant");
    expect(toBiolinkCategory("species")).toBe("biolink:OrganismTaxon");
  });

  it("returns null for an entity type outside the closed vocabulary", () => {
    expect(toBiolinkCategory("phenotype")).toBeNull();
    expect(toBiolinkCategory("")).toBeNull();
  });

  it("maps each predicate to its canonical Biolink predicate", () => {
    expect(toBiolinkPredicate("associates_with")).toBe("biolink:associated_with");
    expect(toBiolinkPredicate("targets")).toBe("biolink:target_for");
    expect(toBiolinkPredicate("treats")).toBe("biolink:treats");
    expect(toBiolinkPredicate("frobnicates")).toBeNull();
  });

  it("keeps BIOLINK_CATEGORY / BIOLINK_PREDICATE consistent with the resolvers", () => {
    expect(BIOLINK_CATEGORY.drug).toBe("biolink:Drug");
    expect(BIOLINK_PREDICATE.treats).toBe("biolink:treats");
  });

  it("resolves the is_a ancestor chain and subsumption (drug is-a ChemicalEntity)", () => {
    expect(biolinkAncestors("drug")).toContain("biolink:Drug");
    expect(biolinkAncestors("drug")).toContain("biolink:ChemicalEntity");
    expect(isCategoryA("drug", "biolink:Drug")).toBe(true);
    expect(isCategoryA("drug", "biolink:ChemicalEntity")).toBe(true);
    expect(isCategoryA("drug", "biolink:NamedThing")).toBe(true);
    expect(isCategoryA("gene", "biolink:Drug")).toBe(false);
  });

  it("validates triple well-typing against Biolink domain/range", () => {
    // drug -treats-> disease is well-typed; drug -treats-> gene is not.
    expect(isWellTypedTriple("drug", "treats", "disease")).toBe(true);
    expect(isWellTypedTriple("drug", "treats", "gene")).toBe(false);
    // gene -associates_with-> disease is well-typed.
    expect(isWellTypedTriple("gene", "associates_with", "disease")).toBe(true);
    // drug -targets-> gene is well-typed; drug -targets-> disease is not.
    expect(isWellTypedTriple("drug", "targets", "gene")).toBe(true);
    expect(isWellTypedTriple("drug", "targets", "disease")).toBe(false);
    // unknown predicate fails closed.
    expect(isWellTypedTriple("drug", "cures", "disease")).toBe(false);
  });
});

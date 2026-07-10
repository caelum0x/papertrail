// Pure data-access layer for the Biomedical Evidence Knowledge Graph.
//
// Every function here is a thin, PARAMETERIZED SQL wrapper over the kg_nodes /
// kg_edges tables (db/migrations/0052_knowledge-graph.sql). No business logic, no
// external calls, no LLM — just persistence and traversal. The graph layer
// (lib/kg/graph.ts) composes these; the API route never touches SQL directly.
//
// The DB surface is captured by the minimal `KgPool` interface (a subset of pg.Pool)
// so tests inject an in-memory fake and run fully offline — mirroring the
// injectable-deps pattern used across lib/bio/* and lib/ingest/searchAndCache.ts.
//
// SECURITY: all SQL is parameterized ($1, $2, ...). No string interpolation of caller
// input ever reaches a query — the only interpolated value is the integer max-hops
// bound, which is clamped to a safe range before use.

import {
  KgEdgeSchema,
  KgNodeSchema,
  KgPathSchema,
  type KgEdge,
  type KgNode,
  type KgNodeInput,
  type KgPath,
  type KgPredicate,
  type KgProvenance,
} from "./schemas";

// The minimal Postgres surface the repository depends on: a single parameterized
// `query`. Matches pg.Pool.query so a real Pool satisfies it directly, and a tiny
// fake satisfies it in tests. Rows are untyped (unknown) — every row is validated
// through a Zod schema before it leaves this module.
export interface KgPool {
  query: (
    sql: string,
    params?: readonly unknown[]
  ) => Promise<{ rows: unknown[] }>;
}

// Hard ceiling on recursive traversal depth, independent of the caller-supplied
// maxHops (which the schema already caps). Defence-in-depth against a runaway walk.
const MAX_HOPS_CEILING = 6;

// ---------------------------------------------------------------------------
// Row parsing — every DB row is validated before use. A malformed row throws in the
// Zod parse rather than silently propagating bad data into a path.
// ---------------------------------------------------------------------------

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" ? (row as Record<string, unknown>) : {};
}

// jsonb columns arrive already parsed from pg; a string is tolerated defensively.
function parseProvenance(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw ?? {};
}

function rowToNode(row: unknown): KgNode {
  const r = asRecord(row);
  return KgNodeSchema.parse({
    id: r.id,
    entityType: r.entity_type,
    name: r.name,
    normalizedId: r.normalized_id,
  });
}

function rowToEdge(row: unknown): KgEdge {
  const r = asRecord(row);
  return KgEdgeSchema.parse({
    id: r.id,
    subjectId: r.subject_id,
    predicate: r.predicate,
    objectId: r.object_id,
    provenance: parseProvenance(r.provenance),
  });
}

// ---------------------------------------------------------------------------
// upsertNode — insert a node, or return the existing one on (entity_type,
// normalized_id) conflict. Idempotent: re-ingesting the same entity yields the same
// row. The `name` is refreshed on conflict so a later, cleaner surface form wins.
// ---------------------------------------------------------------------------

export async function upsertNode(pool: KgPool, input: KgNodeInput): Promise<KgNode> {
  const { rows } = await pool.query(
    `insert into kg_nodes (entity_type, name, normalized_id)
     values ($1, $2, $3)
     on conflict (entity_type, normalized_id)
       do update set name = excluded.name
     returning id, entity_type, name, normalized_id`,
    [input.entityType, input.name, input.normalizedId]
  );
  if (rows.length === 0) {
    throw new Error("upsertNode returned no row");
  }
  return rowToNode(rows[0]);
}

// ---------------------------------------------------------------------------
// upsertEdge — insert a typed relation with provenance, or refresh the provenance of
// an existing (subject, predicate, object) edge. Idempotent on the triple so the
// graph never accumulates duplicate relations.
// ---------------------------------------------------------------------------

export async function upsertEdge(
  pool: KgPool,
  edge: {
    subjectId: string;
    predicate: KgPredicate;
    objectId: string;
    provenance: KgProvenance;
  }
): Promise<KgEdge> {
  const { rows } = await pool.query(
    `insert into kg_edges (subject_id, predicate, object_id, provenance)
     values ($1, $2, $3, $4::jsonb)
     on conflict (subject_id, predicate, object_id)
       do update set provenance = excluded.provenance
     returning id, subject_id, predicate, object_id, provenance`,
    [edge.subjectId, edge.predicate, edge.objectId, JSON.stringify(edge.provenance)]
  );
  if (rows.length === 0) {
    throw new Error("upsertEdge returned no row");
  }
  return rowToEdge(rows[0]);
}

// ---------------------------------------------------------------------------
// getNodeByNormalizedId — resolve a node by its normalized identity. Used by the
// path query to translate a caller-supplied entity id into a graph node.
// ---------------------------------------------------------------------------

export async function getNodeByNormalizedId(
  pool: KgPool,
  normalizedId: string
): Promise<KgNode | null> {
  const { rows } = await pool.query(
    `select id, entity_type, name, normalized_id
       from kg_nodes
      where normalized_id = $1
      limit 1`,
    [normalizedId]
  );
  return rows.length > 0 ? rowToNode(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// neighbors — the outbound edges from a node (subject_id = nodeId), each paired with
// its object node. Directed traversal step used by the path walker.
// ---------------------------------------------------------------------------

export interface KgNeighbor {
  edge: KgEdge;
  node: KgNode;
}

export async function neighbors(pool: KgPool, nodeId: string): Promise<KgNeighbor[]> {
  const { rows } = await pool.query(
    `select e.id            as edge_id,
            e.subject_id    as subject_id,
            e.predicate     as predicate,
            e.object_id     as object_id,
            e.provenance    as provenance,
            n.id            as n_id,
            n.entity_type   as n_entity_type,
            n.name          as n_name,
            n.normalized_id as n_normalized_id
       from kg_edges e
       join kg_nodes n on n.id = e.object_id
      where e.subject_id = $1`,
    [nodeId]
  );

  return rows.map((row) => {
    const r = asRecord(row);
    const edge = rowToEdge({
      id: r.edge_id,
      subject_id: r.subject_id,
      predicate: r.predicate,
      object_id: r.object_id,
      provenance: r.provenance,
    });
    const node = rowToNode({
      id: r.n_id,
      entity_type: r.n_entity_type,
      name: r.n_name,
      normalized_id: r.n_normalized_id,
    });
    return { edge, node };
  });
}

// ---------------------------------------------------------------------------
// findPaths — the shortest directed evidence path from `fromId` to `toId`, walking
// outbound edges up to `maxHops`. Breadth-first so the FIRST path found is a shortest
// one; cycle-safe (a node is never revisited within a path). Returns null when no
// path exists within the hop budget.
//
// Traversal is done in application code over the neighbors() primitive rather than a
// single recursive CTE, so it works identically against the real Pool and the
// in-memory test fake — keeping the whole feature offline-testable. Each returned
// path is validated against KgPathSchema before it leaves the module.
// ---------------------------------------------------------------------------

interface Frontier {
  node: KgNode;
  nodes: KgNode[];
  edges: KgEdge[];
}

export async function findPaths(
  pool: KgPool,
  fromId: string,
  toId: string,
  maxHops: number
): Promise<KgPath | null> {
  const hopBudget = Math.max(1, Math.min(Math.trunc(maxHops), MAX_HOPS_CEILING));

  if (fromId === toId) {
    return null; // a path needs at least one edge
  }

  const origin = await getNodeById(pool, fromId);
  if (!origin) return null;

  const visited = new Set<string>([origin.id]);
  let frontier: Frontier[] = [{ node: origin, nodes: [origin], edges: [] }];

  for (let hop = 0; hop < hopBudget; hop++) {
    const next: Frontier[] = [];
    for (const state of frontier) {
      const outs = await neighbors(pool, state.node.id);
      for (const { edge, node } of outs) {
        if (node.id === toId) {
          return KgPathSchema.parse({
            nodes: [...state.nodes, node],
            edges: [...state.edges, edge],
            hops: state.edges.length + 1,
          });
        }
        if (visited.has(node.id)) continue;
        visited.add(node.id);
        next.push({
          node,
          nodes: [...state.nodes, node],
          edges: [...state.edges, edge],
        });
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return null;
}

async function getNodeById(pool: KgPool, id: string): Promise<KgNode | null> {
  const { rows } = await pool.query(
    `select id, entity_type, name, normalized_id
       from kg_nodes
      where id = $1
      limit 1`,
    [id]
  );
  return rows.length > 0 ? rowToNode(rows[0]) : null;
}

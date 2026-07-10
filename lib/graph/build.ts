import { normalizeName } from "./extract";
import type {
  EntityType,
  EvidenceGraph,
  GraphEdge,
  GraphNode,
  RelationType,
  SourceExtraction,
} from "./schemas";

// Evidence Knowledge Graph — pure AGGREGATION (no LLM, no I/O). Given the grounded
// per-source extractions, merge them into a single { nodes, edges } graph. Entities
// with the same (type, normalized name) collapse to one node across sources. Edges
// with the same (subject, predicate, object) collapse to one edge that accumulates
// ALL of its supporting provenance (which source + which grounded sentence), so the
// UI can show every piece of evidence behind an edge. Every edge here carries at
// least one grounded span — ungroundable relations were already dropped upstream.

/** Canonical node id: `${type}:${normalized name}`. Same entity across sources merges. */
export function nodeId(type: EntityType, name: string): string {
  return `${type}:${normalizeName(name)}`;
}

/** Deterministic edge id independent of provenance count: subject|predicate|object. */
function edgeId(source: string, predicate: RelationType, target: string): string {
  return `${source}|${predicate}|${target}`;
}

/**
 * Aggregate grounded per-source extractions into one evidence graph. Pure function:
 * inputs are not mutated, output is freshly built and deterministic in ordering.
 */
export function buildEvidenceGraph(extractions: readonly SourceExtraction[]): EvidenceGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  let groundedRelationCount = 0;
  let droppedRelationCount = 0;

  const ensureNode = (type: EntityType, name: string): string => {
    const id = nodeId(type, name);
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: name.trim(), type, degree: 0 });
    }
    return id;
  };

  for (const extraction of extractions) {
    droppedRelationCount += extraction.dropped_relations;

    // Seed nodes from declared entities so isolated entities still appear.
    for (const entity of extraction.entities) {
      ensureNode(entity.type, entity.name);
    }

    for (const rel of extraction.relations) {
      groundedRelationCount += 1;
      const sourceNodeId = ensureNode(rel.subject_type, rel.subject);
      const targetNodeId = ensureNode(rel.object_type, rel.object);

      const id = edgeId(sourceNodeId, rel.predicate, targetNodeId);
      const existing = edges.get(id);
      const provenance = {
        source_id: rel.source_id,
        grounded_sentence: rel.grounded_sentence,
        grounding: rel.grounding,
      };

      if (existing) {
        // Immutable update: replace the edge with a copy carrying the new provenance.
        edges.set(id, {
          ...existing,
          provenance: [...existing.provenance, provenance],
        });
      } else {
        edges.set(id, {
          id,
          source: sourceNodeId,
          target: targetNodeId,
          predicate: rel.predicate,
          provenance: [provenance],
        });
      }
    }
  }

  // Compute node degree from the final edge set (each edge touches two nodes; a
  // self-edge counts once). Rebuild nodes immutably with their degree.
  const degree = new Map<string, number>();
  for (const edge of edges.values()) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    if (edge.target !== edge.source) {
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
  }

  const nodeList: GraphNode[] = Array.from(nodes.values())
    .map((n) => ({ ...n, degree: degree.get(n.id) ?? 0 }))
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label));

  const edgeList: GraphEdge[] = Array.from(edges.values()).sort(
    (a, b) => b.provenance.length - a.provenance.length || a.id.localeCompare(b.id)
  );

  const sourceIds = new Set(extractions.map((e) => e.source_id));

  return {
    nodes: nodeList,
    edges: edgeList,
    stats: {
      source_count: sourceIds.size,
      node_count: nodeList.length,
      edge_count: edgeList.length,
      grounded_relation_count: groundedRelationCount,
      dropped_relation_count: droppedRelationCount,
    },
  };
}

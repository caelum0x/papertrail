// Bring-your-own-KG import — the native TypeScript mirror of the PaperTrail BioCypher
// specialization (backend/engines/biocypher/papertrail_byokg.py).
//
// A lab uploads its own nodes and edges; validateAndImportKg pins each node to its
// Biolink category and REJECTS any edge whose predicate violates the Biolink slot
// domain/range — an ill-typed edge is returned with a reason, never coerced into the
// graph. Accepted nodes/edges are written into the shared kg_nodes / kg_edges tables
// (migration 0052) and the run is recorded as a kg_import_batches row (migration 0071).
//
// The typing decision is a pure, deterministic reuse of lib/kg/biolink.ts (which is NOT
// edited here) — the same table the Python engine mirrors. There is NO LLM anywhere in
// this path: same input → same {imported, rejected}, always. A wrong "confident" edge is
// worse than an honest rejection, so we fail closed on anything outside the closed
// vocabulary.

import {
  KgNodeInputSchema,
  KgProvenanceSchema,
  KG_PREDICATES,
  type KgNodeInput,
  type KgPredicate,
  type KgProvenance,
} from "./schemas";
import { toBiolinkCategory, toBiolinkPredicate, isWellTypedTriple } from "./biolink";
import { upsertNode, upsertEdge, type KgPool } from "./repository";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Input shapes for the import. A node input is (entityType, name, normalizedId) — the
// same identity the repository upserts on. An edge input references its endpoints by
// normalizedId (the stable id a caller controls), plus the predicate and the provenance
// carried on every KG edge.
// ---------------------------------------------------------------------------

export const KgImportNodeSchema = KgNodeInputSchema;
export type KgImportNode = KgNodeInput;

export const KgImportEdgeSchema = z.object({
  subject: z.string().trim().min(1).max(256),
  predicate: z.enum(KG_PREDICATES),
  object: z.string().trim().min(1).max(256),
  provenance: KgProvenanceSchema,
});
export type KgImportEdge = z.infer<typeof KgImportEdgeSchema>;

export const KgImportRequestSchema = z.object({
  nodes: z.array(KgImportNodeSchema).min(1).max(2_000),
  edges: z.array(KgImportEdgeSchema).max(10_000),
});
export type KgImportRequest = z.infer<typeof KgImportRequestSchema>;

// A rejected edge: the offending edge (by its normalized endpoints + predicate) and a
// human-readable, machine-stable reason. Mirrors the Python `rejected[]` shape.
export interface RejectedEdge {
  edge: {
    subject: string;
    predicate: KgPredicate;
    object: string;
  };
  reason: string;
}

// The audited result of an import run.
export interface KgImportResult {
  batchId: string;
  imported: {
    nodes: number;
    edges: number;
  };
  rejected: RejectedEdge[];
}

// ---------------------------------------------------------------------------
// Pure validation — mirrors _validate_nodes / _validate_edges in the Python engine.
// Produces the accept/reject decision WITHOUT any DB access, so it is unit-testable and
// deterministic. The persistence step consumes the accepted sets.
// ---------------------------------------------------------------------------

interface AcceptedEdge {
  subjectId: string;
  predicate: KgPredicate;
  objectId: string;
  provenance: KgProvenance;
}

interface ValidationOutcome {
  acceptedNodes: KgImportNode[];
  acceptedEdges: KgImportEdge[];
  rejected: RejectedEdge[];
}

// Split edges into accepted / rejected against the node index, exactly as the Python
// engine does: a blank/unknown endpoint, an unknown predicate, or a triple that violates
// the Biolink domain/range is rejected with a reason; nothing is coerced.
function validateImport(request: KgImportRequest): ValidationOutcome {
  // Index nodes by normalizedId, dropping any whose entity_type is outside the closed
  // vocabulary (toBiolinkCategory returns null). The first valid record for an id wins.
  const typeByNormalizedId = new Map<string, KgImportNode["entityType"]>();
  const acceptedNodes: KgImportNode[] = [];

  for (const node of request.nodes) {
    if (toBiolinkCategory(node.entityType) === null) continue; // unknown type → drop
    if (!typeByNormalizedId.has(node.normalizedId)) {
      acceptedNodes.push(node);
    }
    typeByNormalizedId.set(node.normalizedId, node.entityType);
  }

  const acceptedEdges: KgImportEdge[] = [];
  const rejected: RejectedEdge[] = [];

  for (const edge of request.edges) {
    const ref = { subject: edge.subject, predicate: edge.predicate, object: edge.object };

    const subjectType = typeByNormalizedId.get(edge.subject);
    if (!subjectType) {
      rejected.push({
        edge: ref,
        reason: `subject '${edge.subject}' is not a valid node in the imported nodes`,
      });
      continue;
    }

    const objectType = typeByNormalizedId.get(edge.object);
    if (!objectType) {
      rejected.push({
        edge: ref,
        reason: `object '${edge.object}' is not a valid node in the imported nodes`,
      });
      continue;
    }

    if (!isWellTypedTriple(subjectType, edge.predicate, objectType)) {
      const subjectCat = toBiolinkCategory(subjectType) ?? "unknown";
      const objectCat = toBiolinkCategory(objectType) ?? "unknown";
      const biolinkPredicate = toBiolinkPredicate(edge.predicate) ?? edge.predicate;
      rejected.push({
        edge: ref,
        reason:
          `triple (${subjectCat}) -[${biolinkPredicate}]-> (${objectCat}) violates the ` +
          `Biolink domain/range of predicate '${edge.predicate}'`,
      });
      continue;
    }

    acceptedEdges.push(edge);
  }

  return { acceptedNodes, acceptedEdges, rejected };
}

// ---------------------------------------------------------------------------
// validateAndImportKg — the public entry point the route calls.
//
// Validates the request, upserts accepted nodes/edges into kg_nodes/kg_edges, records a
// kg_import_batches audit row, and returns { imported, rejected }. Node/edge upserts are
// idempotent (see repository.ts), so a re-run of the same import doesn't duplicate rows.
// ---------------------------------------------------------------------------

export async function validateAndImportKg(
  pool: KgPool,
  orgId: string,
  input: { nodes: readonly KgImportNode[]; edges: readonly KgImportEdge[] },
  createdBy?: string
): Promise<KgImportResult> {
  // Re-validate at the trust boundary — never assume the caller pre-validated.
  const request = KgImportRequestSchema.parse({
    nodes: input.nodes,
    edges: input.edges,
  });

  const { acceptedNodes, acceptedEdges, rejected } = validateImport(request);

  // Upsert accepted nodes, building a normalizedId → persisted node id map so edges can
  // resolve their endpoints. Only nodes referenced by an accepted edge strictly need an
  // id, but we persist every accepted node so the graph gains the standalone entities too.
  const idByNormalizedId = new Map<string, string>();
  for (const node of acceptedNodes) {
    const persisted = await upsertNode(pool, node);
    idByNormalizedId.set(node.normalizedId, persisted.id);
  }

  const persistableEdges: AcceptedEdge[] = [];
  for (const edge of acceptedEdges) {
    const subjectId = idByNormalizedId.get(edge.subject);
    const objectId = idByNormalizedId.get(edge.object);
    // Both endpoints are guaranteed present (validation required valid nodes), but we
    // guard defensively rather than assert non-null.
    if (!subjectId || !objectId) continue;
    persistableEdges.push({
      subjectId,
      predicate: edge.predicate,
      objectId,
      provenance: edge.provenance,
    });
  }

  let importedEdges = 0;
  for (const edge of persistableEdges) {
    await upsertEdge(pool, {
      subjectId: edge.subjectId,
      predicate: edge.predicate,
      objectId: edge.objectId,
      provenance: edge.provenance,
    });
    importedEdges += 1;
  }

  const batchId = await recordBatch(pool, {
    orgId,
    nodeCount: acceptedNodes.length,
    edgeCount: importedEdges,
    rejectedCount: rejected.length,
    createdBy,
  });

  return {
    batchId,
    imported: {
      nodes: acceptedNodes.length,
      edges: importedEdges,
    },
    rejected,
  };
}

// Persist the audit row for this import and return its id. Parameterized SQL; the only
// values are counts and ids.
async function recordBatch(
  pool: KgPool,
  batch: {
    orgId: string;
    nodeCount: number;
    edgeCount: number;
    rejectedCount: number;
    createdBy?: string;
  }
): Promise<string> {
  const { rows } = await pool.query(
    `insert into kg_import_batches
       (org_id, node_count, edge_count, rejected_count, created_by)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      batch.orgId,
      batch.nodeCount,
      batch.edgeCount,
      batch.rejectedCount,
      batch.createdBy ?? null,
    ]
  );
  const row = rows[0];
  if (!row || typeof (row as { id?: unknown }).id !== "string") {
    throw new Error("recordBatch returned no id");
  }
  return (row as { id: string }).id;
}

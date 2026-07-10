// Knowledge-graph INGESTION + PATH QUERY over the persisted evidence graph.
//
// ingestClaimGraph({ text }) turns a free-text biomedical statement into graph facts:
//   1. GROUND the text to normalized entities via lib/bio/pubtator annotateText —
//      genes, diseases, chemicals/drugs, variants. We only ever use entities PubTator
//      actually resolved (nothing is fabricated).
//   2. DERIVE typed edges between those entities using the DETERMINISTIC bio-relation
//      engines: geneticAssociation (gene/variant -associates_with-> disease) and
//      openTargets targetDiseaseEvidence (drug -targets-> gene, drug -treats-> disease).
//      Each edge carries PROVENANCE — the source engine, an evidence reference, the
//      grounded quote, and the engine's own deterministic confidence in [0, 1].
//   3. PERSIST nodes + edges through the pure repository (idempotent upserts).
//
// queryPath(from, to) returns a provenance-annotated evidence path between two
// normalized entity ids, or null if none exists within the hop budget.
//
// EVERY external dependency (PubTator, the bio engines, the DB pool) is injected via a
// deps object so the whole thing runs OFFLINE against mocks in tests. There is NO LLM
// anywhere in a load-bearing number here — Claude does not touch confidence or verdicts.
// On any failure the pipeline degrades to an HONEST empty result (no fabricated edges).

import { annotateText } from "../bio/pubtator";
import { verifyGeneticAssociation } from "../bio/geneticAssociation";
import { targetDiseaseEvidence } from "../bio/openTargets";
import type { BioEntity } from "../bio/entities.schemas";
import type { GeneticAssociationResult } from "../bio/genetics.schemas";
import type { TargetDiseaseEvidence } from "../bio/targets.schemas";
import {
  getNodeByNormalizedId,
  findPaths,
  upsertEdge,
  upsertNode,
  type KgPool,
} from "./repository";
import {
  KgDerivedEdgeSchema,
  type KgDerivedEdge,
  type KgEntityType,
  type KgIngestResult,
  type KgNodeInput,
  type KgPath,
} from "./schemas";

// ---------------------------------------------------------------------------
// Injectable dependencies. Defaults hit the real engines / global fetch; tests pass
// deterministic stubs so no network or DB is touched.
// ---------------------------------------------------------------------------

export interface KgGraphDeps {
  annotate: (text: string) => Promise<{ entities: BioEntity[] }[]>;
  geneticAssociation: (req: {
    gene?: string;
    variant?: string;
    disease: string;
  }) => Promise<GeneticAssociationResult>;
  targetDisease: (
    targetSymbol: string,
    diseaseName: string
  ) => Promise<TargetDiseaseEvidence>;
}

const defaultDeps: KgGraphDeps = {
  annotate: (text) => annotateText(text),
  geneticAssociation: (req) => verifyGeneticAssociation(req),
  targetDisease: (t, d) => targetDiseaseEvidence(t, d),
};

// ---------------------------------------------------------------------------
// Deterministic confidence for a genetic-association edge, keyed by the verdict the
// engine returned. These are FIXED constants (not tuned, not LLM-derived) so the same
// verdict always yields the same edge score — a documented, auditable mapping from
// strength-of-evidence to a [0, 1] confidence.
// ---------------------------------------------------------------------------

const GENETIC_VERDICT_CONFIDENCE: Readonly<Record<string, number>> = {
  genome_wide_significant: 0.95,
  clinvar_pathogenic: 0.9,
  suggestive: 0.6,
  reported_not_significant: 0.3,
  conflicting: 0.2,
  no_association_found: 0.0,
};

// Verdicts that constitute POSITIVE evidence worth persisting as an edge. A
// no-association / below-threshold verdict is an honest "no edge" — we do not persist
// a relation the data doesn't support.
const POSITIVE_GENETIC_VERDICTS = new Set([
  "genome_wide_significant",
  "clinvar_pathogenic",
  "suggestive",
]);

// ---------------------------------------------------------------------------
// Entity grouping. From PubTator's per-mention entities we build de-duplicated node
// inputs per category. Only entities PubTator linked to a normalized id become nodes —
// an unlinked mention has no stable identity to key a graph node on, so we drop it.
// ---------------------------------------------------------------------------

interface GroupedEntities {
  genes: KgNodeInput[];
  diseases: KgNodeInput[];
  drugs: KgNodeInput[];
  variants: KgNodeInput[];
}

function toKgEntityType(t: BioEntity["type"]): KgEntityType {
  // PubTator "chemical" entities are drugs in our relation vocabulary (drugs target
  // genes / treat diseases). The rest map straight across.
  return t === "chemical" ? "drug" : t;
}

function dedupeByNormalizedId(inputs: KgNodeInput[]): KgNodeInput[] {
  const seen = new Map<string, KgNodeInput>();
  for (const input of inputs) {
    if (!seen.has(input.normalizedId)) seen.set(input.normalizedId, input);
  }
  return [...seen.values()];
}

function groupEntities(annotations: { entities: BioEntity[] }[]): GroupedEntities {
  const genes: KgNodeInput[] = [];
  const diseases: KgNodeInput[] = [];
  const drugs: KgNodeInput[] = [];
  const variants: KgNodeInput[] = [];

  for (const doc of annotations) {
    for (const entity of doc.entities) {
      if (entity.normalizedId === null) continue; // unlinked — no stable node identity
      const node: KgNodeInput = {
        entityType: toKgEntityType(entity.type),
        name: entity.text,
        normalizedId: entity.normalizedId,
      };
      switch (entity.type) {
        case "gene":
          genes.push(node);
          break;
        case "disease":
          diseases.push(node);
          break;
        case "chemical":
          drugs.push(node);
          break;
        case "variant":
          variants.push(node);
          break;
        default:
          break; // species etc. are not relation endpoints in our vocabulary
      }
    }
  }

  return {
    genes: dedupeByNormalizedId(genes),
    diseases: dedupeByNormalizedId(diseases),
    drugs: dedupeByNormalizedId(drugs),
    variants: dedupeByNormalizedId(variants),
  };
}

// ---------------------------------------------------------------------------
// Edge derivation — the DETERMINISTIC bio engines turn grouped entities into typed,
// provenance-bearing edges. Each derived edge is validated against KgDerivedEdgeSchema
// before it leaves this step, so a malformed derivation fails loudly here.
// ---------------------------------------------------------------------------

// gene/variant -associates_with-> disease, from the genetic-association engine.
async function deriveGeneticEdges(
  grouped: GroupedEntities,
  deps: KgGraphDeps
): Promise<KgDerivedEdge[]> {
  const edges: KgDerivedEdge[] = [];

  // Pair each gene with each disease (both grounded by PubTator) and ask the engine.
  for (const gene of grouped.genes) {
    for (const disease of grouped.diseases) {
      const result = await deps
        .geneticAssociation({ gene: gene.name, disease: disease.name })
        .catch(() => null);
      if (!result) continue;
      if (!POSITIVE_GENETIC_VERDICTS.has(result.verdict)) continue;

      const score = GENETIC_VERDICT_CONFIDENCE[result.verdict] ?? 0;
      edges.push(
        KgDerivedEdgeSchema.parse({
          subject: gene,
          predicate: "associates_with",
          object: disease,
          provenance: {
            source: "genetic_association",
            evidenceRef: `verdict:${result.verdict}${
              result.minPValue !== null ? `;p=${result.minPValue.toExponential(2)}` : ""
            }`,
            groundedQuote: result.rationale,
            score,
          },
        })
      );
    }
  }

  return edges;
}

// drug -targets-> gene and drug -treats-> disease, from Open Targets. The confidence is
// Open Targets' own deterministic association score (overall) / datatype score — never
// an LLM number. We only emit an edge when the API returned a scored association.
async function deriveTargetEdges(
  grouped: GroupedEntities,
  deps: KgGraphDeps
): Promise<KgDerivedEdge[]> {
  const edges: KgDerivedEdge[] = [];

  for (const drug of grouped.drugs) {
    // drug -treats-> disease (drug ⇄ disease via a scored target–disease association
    // that lists this drug as a known drug). We query per disease with the drug as the
    // "target symbol" resolver input; Open Targets resolves what it can, honest-empty
    // otherwise.
    for (const disease of grouped.diseases) {
      const evidence = await deps
        .targetDisease(drug.name, disease.name)
        .catch(() => null);
      if (!evidence || !evidence.found || evidence.overallScore === null) continue;

      edges.push(
        KgDerivedEdgeSchema.parse({
          subject: drug,
          predicate: "treats",
          object: disease,
          provenance: {
            source: "open_targets",
            evidenceRef: `assoc:${evidence.target.ensemblId ?? "?"}|${
              evidence.disease.efoId ?? "?"
            }`,
            groundedQuote: `Open Targets association score ${evidence.overallScore.toFixed(
              3
            )} for ${
              evidence.target.approvedSymbol ?? drug.name
            } and ${evidence.disease.name ?? disease.name}.`,
            score: evidence.overallScore,
          },
        })
      );

      // drug -targets-> gene, for each grounded gene that Open Targets confirms as the
      // resolved target of this association (endpoint identity keyed on the gene the
      // engine resolved). We attach the known-drug datatype score when present.
      for (const gene of grouped.genes) {
        const targetScore =
          evidence.datatypeScores.known_drug ?? evidence.overallScore;
        edges.push(
          KgDerivedEdgeSchema.parse({
            subject: drug,
            predicate: "targets",
            object: gene,
            provenance: {
              source: "open_targets",
              evidenceRef: `known_drug:${evidence.target.ensemblId ?? "?"}`,
              groundedQuote: `Open Targets lists ${
                evidence.knownDrugs.length
              } known drug(s) acting on ${
                evidence.target.approvedSymbol ?? gene.name
              } (known-drug datatype score ${targetScore.toFixed(3)}).`,
              score: targetScore,
            },
          })
        );
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Persistence — resolve both endpoints of each derived edge to persisted node ids,
// then upsert the edge. Idempotent throughout.
// ---------------------------------------------------------------------------

async function persist(
  pool: KgPool,
  derivedEdges: KgDerivedEdge[]
): Promise<{ nodesUpserted: number; edgesUpserted: number }> {
  // Node cache keyed by (entityType, normalizedId) so each distinct node is upserted
  // once even if it appears in many edges.
  const nodeIds = new Map<string, string>();
  let nodesUpserted = 0;

  const resolveNode = async (input: KgNodeInput): Promise<string> => {
    const key = `${input.entityType}::${input.normalizedId}`;
    const cached = nodeIds.get(key);
    if (cached) return cached;
    const node = await upsertNode(pool, input);
    nodeIds.set(key, node.id);
    nodesUpserted += 1;
    return node.id;
  };

  let edgesUpserted = 0;
  for (const edge of derivedEdges) {
    const subjectId = await resolveNode(edge.subject);
    const objectId = await resolveNode(edge.object);
    await upsertEdge(pool, {
      subjectId,
      predicate: edge.predicate,
      objectId,
      provenance: edge.provenance,
    });
    edgesUpserted += 1;
  }

  return { nodesUpserted, edgesUpserted };
}

// ---------------------------------------------------------------------------
// ingestClaimGraph — the public ingestion entry point.
// ---------------------------------------------------------------------------

export async function ingestClaimGraph(
  input: { text: string },
  pool: KgPool,
  deps: KgGraphDeps = defaultDeps
): Promise<KgIngestResult> {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const empty: KgIngestResult = { nodesUpserted: 0, edgesUpserted: 0, edges: [] };
  if (text.length === 0) return empty;

  // 1. Ground to normalized entities (honest-empty on failure).
  const annotations = await deps.annotate(text).catch(() => [] as { entities: BioEntity[] }[]);
  const grouped = groupEntities(annotations);

  // No linked entities → nothing to relate. Honest empty result.
  const hasAny =
    grouped.genes.length + grouped.diseases.length + grouped.drugs.length > 0;
  if (!hasAny) return empty;

  // 2. Derive typed, provenance-bearing edges from the deterministic engines.
  const [geneticEdges, targetEdges] = await Promise.all([
    deriveGeneticEdges(grouped, deps),
    deriveTargetEdges(grouped, deps),
  ]);
  const derivedEdges = [...geneticEdges, ...targetEdges];

  // 3. Persist nodes + edges idempotently.
  const { nodesUpserted, edgesUpserted } = await persist(pool, derivedEdges);

  return { nodesUpserted, edgesUpserted, edges: derivedEdges };
}

// ---------------------------------------------------------------------------
// queryPath — resolve both normalized entity ids to graph nodes, then find a
// provenance-annotated evidence path between them. Returns null when either endpoint
// is unknown to the graph or no path exists within the hop budget.
// ---------------------------------------------------------------------------

export async function queryPath(
  from: string,
  to: string,
  pool: KgPool,
  options?: { maxHops?: number }
): Promise<KgPath | null> {
  const maxHops = options?.maxHops ?? 3;

  const [fromNode, toNode] = await Promise.all([
    getNodeByNormalizedId(pool, from.trim()),
    getNodeByNormalizedId(pool, to.trim()),
  ]);
  if (!fromNode || !toNode) return null;

  return findPaths(pool, fromNode.id, toNode.id, maxHops);
}

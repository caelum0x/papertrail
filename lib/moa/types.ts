// PaperTrail Mixture-of-Agents (MoA) — the shared contract for REAL COMPOSITION.
//
// Agents do not run blind and get summed. They COMPOSE: each agent declares the typed
// artifacts it PRODUCES and CONSUMES, writes its findings to a shared BLACKBOARD, and
// later agents READ upstream artifacts to do their work. The scheduler topologically
// orders agents by these data dependencies into layers:
//
//   LAYER 1 · ENRICHERS   produce artifacts (entities, effect_sizes, quality, relevance,
//                         design_priors, mechanisms) — they enrich, they do not vote.
//   LAYER 2 · VERIFIERS   consume enricher artifacts, then vote. MiniCheck produces
//                         source_labels; MultiVerS/Valsci/STORM CONSUME those labels.
//                         PyMARE consumes effect_sizes. This is the composition.
//   LAYER 3 · DELIBERATION STORM debates the contested_sources Valsci produced; the
//                         research agents consume the whole blackboard.
//   LAYER 4 · AGGREGATE   deterministic mix of the votes -> verdict + trust (the moat),
//                         then a grounded Claude synthesizer writes the narrative.
//
// MOAT: the routing gate, the scheduler, and the final numeric mix are deterministic.
// Claude runs only inside agents' grounded language steps, the advisory planner, and the
// explanatory synthesizer — never in the verdict/scoring path.

// ---------------------------------------------------------------------------
// Input context handed to every agent (immutable per request).
// ---------------------------------------------------------------------------

export interface MoaSource {
  id: string;
  text: string;
  title?: string;
  url?: string;
  journal?: string;
  year?: number;
  citations?: number;
  isPreprint?: boolean;
  isOpenAccess?: boolean;
  retracted?: boolean;
  doi?: string;
  // Optional pre-classification; if absent, MiniCheck will PRODUCE it for consumers.
  label?: "SUPPORTS" | "REFUTES" | "NEI";
  labelConfidence?: number;
}

export interface MoaOptions {
  llm: boolean;
  maxAgents?: number;
}

export interface OrchestrationContext {
  claim: string;
  sources: readonly MoaSource[];
  options: MoaOptions;
}

// ---------------------------------------------------------------------------
// The ARTIFACT taxonomy — the typed things agents pass to each other. This is the
// vocabulary of composition. Each kind maps to a payload shape in ArtifactPayloads.
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | "entities" // scispaCy: grounded biomedical mentions + CURIEs
  | "relevance" // Loki: per-source on-topic frame-overlap ranking
  | "effect_sizes" // quant-extractor: parsed HR/RR/OR + CI per source
  | "quality" // paper-qa: per-source tier + quality weight
  | "design_priors" // pytrials: per-source trial-design credibility weight
  | "mechanisms" // INDRA: grounded causal statements
  | "source_labels" // MiniCheck: per-source SUPPORTS/REFUTES/NEI + grounded span
  | "contested" // Valsci: which sources conflict + on what dimension
  | "sufficiency" // open_deep_research: body-of-evidence adequacy
  | "debate" // STORM: structured debate on the contested claim
  | "research_brief"; // autoreview/autogather/autoloop: synthesized brief

export interface GroundedSpan {
  sourceId: string;
  text: string;
  start: number;
  end: number;
}

export interface EntityMention {
  sourceId: string;
  text: string;
  curie: string | null;
  type: string;
  span: GroundedSpan | null;
}

export interface SourceRelevance {
  rankById: Record<string, number>; // sourceId -> on-topic score in [0,1]
  droppedIds: string[]; // sources ruled off-topic
}

export interface ParsedEffectSize {
  sourceId: string;
  measure: "HR" | "RR" | "OR";
  point: number;
  ciLow: number;
  ciHigh: number;
  raw: string; // verbatim substring the extractor matched
}

export interface SourceQuality {
  weightById: Record<string, { tier: string; weight: number }>;
  meanWeight: number;
  retractedIds: string[];
}

export interface DesignPrior {
  sourceId: string;
  tier: string;
  priorWeight: number;
}

export interface CausalStatement {
  subject: string;
  relation: string;
  object: string;
  belief: number;
  span: GroundedSpan | null;
}

export interface SourceLabel {
  sourceId: string;
  label: "SUPPORTS" | "REFUTES" | "NEI";
  confidence: number;
  span: GroundedSpan | null;
}

export interface ContestedFinding {
  sourceIds: string[];
  dimension: string; // e.g. "dose", "population", "endpoint"
  category: string; // resolution_category from Valsci
}

export interface SufficiencyFinding {
  sufficient: boolean;
  reasons: string[];
  k: number;
  participants: number;
}

export interface DebateFinding {
  stance: string;
  supportingCount: number;
  refutingCount: number;
  margin: number;
}

export interface ResearchBriefFinding {
  summary: string;
  citations: GroundedSpan[];
}

// The type map that makes blackboard reads type-safe: kind -> payload type.
export interface ArtifactPayloads {
  entities: EntityMention[];
  relevance: SourceRelevance;
  effect_sizes: ParsedEffectSize[];
  quality: SourceQuality;
  design_priors: DesignPrior[];
  mechanisms: CausalStatement[];
  source_labels: SourceLabel[];
  contested: ContestedFinding;
  sufficiency: SufficiencyFinding;
  debate: DebateFinding;
  research_brief: ResearchBriefFinding;
}

// ---------------------------------------------------------------------------
// The BLACKBOARD — typed, append-only shared memory the agents compose through.
// The implementation lives in blackboard.ts; agents depend only on this interface.
// ---------------------------------------------------------------------------
export interface Blackboard {
  // Read the artifact of a kind, or undefined if no agent produced it yet.
  get<K extends ArtifactKind>(kind: K): ArtifactPayloads[K] | undefined;
  // True if an artifact of this kind is available.
  has(kind: ArtifactKind): boolean;
  // Write an artifact (agentId recorded for provenance). Called by the scheduler after run.
  put<K extends ArtifactKind>(agentId: string, kind: K, payload: ArtifactPayloads[K]): void;
  // Which agent produced a given kind, for the UI trace.
  producerOf(kind: ArtifactKind): string | undefined;
}

// ---------------------------------------------------------------------------
// The agent's OUTPUT — its vote and/or the artifacts it produced this run.
// ---------------------------------------------------------------------------

export type AgentSignal =
  | "supports"
  | "refutes"
  | "mixed"
  | "insufficient"
  | "neutral";

export type AgentCategory =
  | "enricher"
  | "verification"
  | "retrieval"
  | "bio-kg"
  | "meta"
  | "screening"
  | "sources"
  | "deliberation";

// Artifacts an agent writes back to the blackboard this run, keyed by kind.
export type ProducedArtifacts = Partial<{
  [K in ArtifactKind]: ArtifactPayloads[K];
}>;

export interface AgentContribution {
  agentId: string;
  ran: boolean;
  signal: AgentSignal;
  confidence: number;
  summary: string;
  detail: Record<string, unknown>;
  groundedSpans: GroundedSpan[];
  usedClaude: boolean;
  // Artifacts this run produced (the scheduler writes them to the blackboard).
  produced: ProducedArtifacts;
  error?: string;
}

// ---------------------------------------------------------------------------
// The AGENT — one backend engine, composed into the mixture.
// ---------------------------------------------------------------------------
export interface MoaAgent {
  id: string;
  name: string;
  category: AgentCategory;
  description: string;
  // Relative AUTHORITY of this agent's vote in the deterministic mix (default 1). A mixture of
  // EXPERTS is not a mixture of equals: the primary-source auditor (full extract -> audit ->
  // ground -> reconcile) is far more authoritative than a single enricher signal, so it carries
  // more weight and is not out-voted by a crowd of weaker agents. Multiplies the vote weight in
  // aggregate.ts. Deterministic and fixed per agent — never learned, never LLM-set.
  authority?: number;
  // Artifact kinds this agent WRITES (used to order the DAG + let consumers depend on it).
  produces: readonly ArtifactKind[];
  // Artifact kinds this agent READS (soft deps: it runs after producers of these, but may
  // still run — degraded — if a consumed artifact ends up absent).
  consumes: readonly ArtifactKind[];
  // Deterministic eligibility in [0,1] from the input alone (NOT the blackboard — gate runs
  // before scheduling). 0 => never participates. Pure, side-effect-free, never throws.
  gate(ctx: OrchestrationContext): number;
  // Do the work: read upstream artifacts from the blackboard, produce this agent's vote +
  // artifacts. Must NOT throw for ordinary "missing input" — return a ran:false contribution.
  // Must be stateless (no DB pool).
  run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution>;
}

// ---------------------------------------------------------------------------
// Shared helpers — keep every agent terse and consistent.
// ---------------------------------------------------------------------------

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function makeContribution(
  agentId: string,
  partial: Partial<Omit<AgentContribution, "agentId">>
): AgentContribution {
  return {
    agentId,
    ran: partial.ran ?? true,
    signal: partial.signal ?? "neutral",
    confidence: clamp01(partial.confidence ?? 0),
    summary: partial.summary ?? "",
    detail: partial.detail ?? {},
    groundedSpans: partial.groundedSpans ?? [],
    usedClaude: partial.usedClaude ?? false,
    produced: partial.produced ?? {},
    ...(partial.error !== undefined ? { error: partial.error } : {}),
  };
}

export function skippedContribution(agentId: string, summary: string): AgentContribution {
  return makeContribution(agentId, {
    ran: false,
    signal: "insufficient",
    confidence: 0,
    summary,
  });
}

export function erroredContribution(agentId: string, err: unknown): AgentContribution {
  const message = err instanceof Error ? err.message : "agent failed";
  return makeContribution(agentId, {
    ran: false,
    signal: "insufficient",
    confidence: 0,
    summary: "This agent could not complete and did not vote.",
    error: message,
  });
}

export function signalFromLabel(label: MoaSource["label"]): AgentSignal {
  switch (label) {
    case "SUPPORTS":
      return "supports";
    case "REFUTES":
      return "refutes";
    case "NEI":
      return "insufficient";
    default:
      return "neutral";
  }
}

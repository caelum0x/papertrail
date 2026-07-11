// PaperTrail MoA — the top-level ORCHESTRATOR. Runs the full composition pipeline:
//
//   0. PLANNER (optional Claude)   -> advisory routing boosts
//   0. ROUTER  (deterministic)     -> which agents participate
//   1..3 SCHEDULER (deterministic) -> orders agents by data deps into layers; each layer
//        runs in parallel then commits its artifacts to the blackboard, so downstream
//        agents genuinely consume upstream findings (real composition)
//   4. AGGREGATE (deterministic)   -> mix the votes into verdict + trust (the moat)
//      SYNTHESIZE (optional Claude) -> grounded narrative
//
// Stateless: no DB pool, safe for a public compute route.

import type {
  AgentContribution,
  MoaAgent,
  MoaSource,
  OrchestrationContext,
} from "./types";
import { AGENTS } from "./registry";
import { planBoosts, type PlannerResult } from "./planner";
import { route, type RoutingDecision } from "./router";
import { schedule, type ScheduledLayer } from "./scheduler";
import { aggregate, type MoaAggregate, type WeightedContribution } from "./aggregate";
import { synthesize, type SynthesisResult } from "./synthesize";

export interface OrchestrateInput {
  claim: string;
  sources: readonly MoaSource[];
  options?: { llm?: boolean; maxAgents?: number };
}

export interface AgentRunTrace {
  agentId: string;
  name: string;
  category: string;
  layer: number;
  finalGate: number;
  contribution: AgentContribution;
}

export interface OrchestrateResult {
  claim: string;
  sourceCount: number;
  routing: RoutingDecision[];
  planner: { usedClaude: boolean; rationale: PlannerResult["rationale"] };
  // The executed composition DAG.
  layers: ScheduledLayer[];
  provenance: Array<{ kind: string; agentId: string }>;
  agents: AgentRunTrace[];
  aggregate: MoaAggregate;
  narrative: string;
  narrativeUsedClaude: boolean;
  citations: SynthesisResult["citations"];
  usedClaude: boolean;
}

/**
 * Run the full Mixture-of-Agents pipeline for one claim. Verdict + trust come only from the
 * deterministic aggregator; Claude touches routing (advisory) and the narrative (grounded
 * explanation) but never the numeric mix.
 */
export async function orchestrate(
  input: OrchestrateInput,
  agents: readonly MoaAgent[] = AGENTS
): Promise<OrchestrateResult> {
  const ctx: OrchestrationContext = {
    claim: input.claim,
    sources: input.sources,
    options: {
      llm: input.options?.llm ?? true,
      maxAgents: input.options?.maxAgents,
    },
  };

  // Layer 0a — planner boosts (Claude, advisory). Degrades to {} on failure.
  const planner = await planBoosts(ctx, agents);

  // Layer 0b — deterministic routing (never revives a 0 gate).
  const routing = route(agents, ctx, planner.boosts);
  const gateById = new Map(routing.decisions.map((d) => [d.agentId, d.finalGate]));
  const metaById = new Map(agents.map((a) => [a.id, a]));

  // Layers 1..3 — schedule + run the selected agents as a composition DAG.
  const scheduled = await schedule(routing.selected, ctx);
  const layerOf = new Map<string, number>();
  for (const layer of scheduled.layers) {
    for (const id of layer.agentIds) layerOf.set(id, layer.index);
  }

  // Pair each contribution with its final gate + category for weighting.
  const weighted: WeightedContribution[] = scheduled.contributions.map((c) => {
    const agent = metaById.get(c.agentId);
    return {
      agentId: c.agentId,
      name: agent?.name ?? c.agentId,
      category: agent?.category ?? "sources",
      gate: gateById.get(c.agentId) ?? 0,
      authority: agent?.authority ?? 1,
      contribution: c,
    };
  });

  // Layer 4 — deterministic mix.
  const agg = aggregate(weighted);

  // Layer 4 — grounded narrative (Claude, explanatory only).
  const synthesis = await synthesize({
    claim: input.claim,
    aggregate: agg,
    contributions: scheduled.contributions,
    llm: ctx.options.llm,
  });

  const agentTrace: AgentRunTrace[] = weighted.map((w) => ({
    agentId: w.agentId,
    name: w.name,
    category: w.category,
    layer: layerOf.get(w.agentId) ?? 0,
    finalGate: w.gate,
    contribution: w.contribution,
  }));

  const usedClaude =
    planner.usedClaude ||
    synthesis.usedClaude ||
    scheduled.contributions.some((c) => c.usedClaude);

  return {
    claim: input.claim,
    sourceCount: input.sources.length,
    routing: routing.decisions,
    planner: { usedClaude: planner.usedClaude, rationale: planner.rationale },
    layers: scheduled.layers,
    provenance: scheduled.provenance,
    agents: agentTrace,
    aggregate: agg,
    narrative: synthesis.narrative,
    narrativeUsedClaude: synthesis.usedClaude,
    citations: synthesis.citations,
    usedClaude,
  };
}

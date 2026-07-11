// PaperTrail MoA — LAYER 0 router. DETERMINISTIC agent selection (which agents
// PARTICIPATE). The scheduler then orders the selected agents by their data dependencies.
//
// Each agent exposes gate(ctx) -> [0,1]. An optional Claude planner adds a per-agent BOOST.
// INVARIANT: a boost can raise a positive gate but can NEVER revive a gate of 0 — the
// planner emphasizes, it never fabricates relevance.

import type { MoaAgent, OrchestrationContext } from "./types";
import { clamp01 } from "./types";

export const DEFAULT_ROUTER_THRESHOLD = 0.15;
export const DEFAULT_MAX_AGENTS = 24;

export interface RoutingDecision {
  agentId: string;
  name: string;
  category: string;
  description: string;
  produces: string[];
  consumes: string[];
  baseGate: number;
  boost: number;
  finalGate: number;
  selected: boolean;
}

export interface RouterResult {
  decisions: RoutingDecision[];
  selected: MoaAgent[];
}

export type PlannerBoosts = Readonly<Record<string, number>>;

const MAX_BOOST = 0.35;
function normalizeBoost(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > MAX_BOOST) return MAX_BOOST;
  return raw;
}

/**
 * Select the agents to participate. Pure/deterministic given (agents, ctx, boosts):
 * computes each agent's base gate, applies the planner boost (never reviving a 0 gate),
 * and selects those at/above threshold, highest final gate first, capped.
 */
export function route(
  agents: readonly MoaAgent[],
  ctx: OrchestrationContext,
  boosts: PlannerBoosts = {},
  opts: { threshold?: number; maxAgents?: number } = {}
): RouterResult {
  const threshold = opts.threshold ?? DEFAULT_ROUTER_THRESHOLD;
  const maxAgents = opts.maxAgents ?? ctx.options.maxAgents ?? DEFAULT_MAX_AGENTS;

  const decisions: RoutingDecision[] = agents.map((a) => {
    const baseGate = clamp01(safeGate(a, ctx));
    const boost = normalizeBoost(boosts[a.id]);
    const finalGate = baseGate === 0 ? 0 : clamp01(baseGate + boost);
    return {
      agentId: a.id,
      name: a.name,
      category: a.category,
      description: a.description,
      produces: [...a.produces],
      consumes: [...a.consumes],
      baseGate: round4(baseGate),
      boost: round4(boost),
      finalGate: round4(finalGate),
      selected: false,
    };
  });

  const ranked = decisions
    .map((d, i) => ({ d, agent: agents[i] }))
    .filter(({ d }) => d.finalGate >= threshold)
    .sort((a, b) => {
      if (b.d.finalGate !== a.d.finalGate) return b.d.finalGate - a.d.finalGate;
      if (b.d.baseGate !== a.d.baseGate) return b.d.baseGate - a.d.baseGate;
      return a.d.agentId < b.d.agentId ? -1 : a.d.agentId > b.d.agentId ? 1 : 0;
    });

  const chosen = ranked.slice(0, maxAgents);
  const chosenIds = new Set(chosen.map((c) => c.d.agentId));
  for (const d of decisions) {
    if (chosenIds.has(d.agentId)) d.selected = true;
  }

  return { decisions, selected: chosen.map((c) => c.agent) };
}

function safeGate(agent: MoaAgent, ctx: OrchestrationContext): number {
  try {
    return agent.gate(ctx);
  } catch {
    return 0;
  }
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

// PaperTrail MoA — the optional Claude PLANNER. Reads the claim and the roster of
// experts and proposes a small BOOST per expert (which the router applies but which can
// never revive a gate of 0). This is the only place Claude influences routing, and it is
// strictly advisory: it re-weights, it never decides the verdict and never fabricates
// relevance. If the planner is disabled or fails, routing falls back to pure deterministic
// gating — the system is fully functional without it.

import { z } from "zod";
import type { MoaAgent, OrchestrationContext } from "./types";
import type { PlannerBoosts } from "./router";

// The planner may nudge an expert up by at most this much; kept small so the deterministic
// gate remains the dominant signal.
const PLANNER_MAX_BOOST = 0.3;

const PlannerOutputSchema = z.object({
  boosts: z
    .array(
      z.object({
        expertId: z.string(),
        // 0..1 from the model; we rescale into the allowed additive band below.
        emphasis: z.number().min(0).max(1),
        reason: z.string().max(240).default(""),
      })
    )
    .default([]),
});

export interface PlannerResult {
  boosts: PlannerBoosts;
  rationale: Array<{ expertId: string; emphasis: number; reason: string }>;
  usedClaude: boolean;
}

// Injectable Claude caller so this module is testable offline and imports the SDK lazily.
export type PlannerClaudeCaller = <T>(args: {
  system: string;
  user: string;
  schema: { parse: (v: unknown) => T };
  maxTokens?: number;
}) => Promise<T>;

const PLANNER_SYSTEM =
  "You are the routing planner for PaperTrail's Mixture-of-Agents evidence verifier. You " +
  "are given a CLAIM and a roster of expert engines (id, name, what each contributes). Decide " +
  "which experts are MOST worth emphasizing for THIS claim and return an emphasis in [0,1] per " +
  "expert you want to nudge up (omit experts you have no opinion on). You do NOT decide the " +
  "verdict, you do NOT rank sources, and your emphasis can only RAISE an expert the system has " +
  "already judged relevant — it can never force an irrelevant expert to run. Prefer emphasizing " +
  "quantitative verification (effect-size meta-analysis, entailment, cross-source aggregation) " +
  "for efficacy/safety magnitude claims. Return ONLY JSON: " +
  '{"boosts":[{"expertId":string,"emphasis":number,"reason":string}]}.';

function buildPlannerUser(ctx: OrchestrationContext, agents: readonly MoaAgent[]): string {
  return JSON.stringify({
    claim: ctx.claim,
    sourceCount: ctx.sources.length,
    experts: agents.map((e) => ({
      id: e.id,
      name: e.name,
      category: e.category,
      contributes: e.description,
    })),
  });
}

const lazyClaude: PlannerClaudeCaller = async (args) => {
  const { callClaudeForJson } = await import("../claude");
  return callClaudeForJson(args);
};

/**
 * Ask the Claude planner for advisory routing boosts. Never throws: on any failure it
 * returns empty boosts (usedClaude:false) so routing degrades to pure deterministic gating.
 * The returned boosts are keyed by expertId and already rescaled into the router's band.
 */
export async function planBoosts(
  ctx: OrchestrationContext,
  agents: readonly MoaAgent[],
  caller: PlannerClaudeCaller = lazyClaude
): Promise<PlannerResult> {
  if (!ctx.options.llm || agents.length === 0) {
    return { boosts: {}, rationale: [], usedClaude: false };
  }

  const validIds = new Set(agents.map((e) => e.id));
  try {
    const raw = await caller({
      system: PLANNER_SYSTEM,
      user: buildPlannerUser(ctx, agents),
      schema: PlannerOutputSchema,
      maxTokens: 700,
    });

    const boosts: Record<string, number> = {};
    const rationale: PlannerResult["rationale"] = [];
    for (const b of raw.boosts) {
      // Ignore ids the model invented; only emphasize real experts.
      if (!validIds.has(b.expertId)) continue;
      const boost = b.emphasis * PLANNER_MAX_BOOST;
      boosts[b.expertId] = boost;
      rationale.push({ expertId: b.expertId, emphasis: b.emphasis, reason: b.reason });
    }
    return { boosts, rationale, usedClaude: true };
  } catch {
    return { boosts: {}, rationale: [], usedClaude: false };
  }
}

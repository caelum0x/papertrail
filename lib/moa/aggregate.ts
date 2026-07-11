// PaperTrail MoA — LAYER 4 aggregator. Deterministically MIXES the agents' votes into one
// verdict + trust score. NO LLM here: this is the moat. Same votes => same verdict.
//
// Composition reaches the mix indirectly: verifier agents already READ the blackboard
// (relevance, quality, labels, effect sizes) and fold those upstream findings into their
// own confidence before voting. The aggregator then weights each vote by
// gate x confidence x categoryWeight. `neutral` agents (enrichers, ranking, entities,
// mechanism) provide context and never vote; `insufficient` lowers evidence strength.

import type { AgentCategory, AgentContribution, AgentSignal } from "./types";
import { clamp01 } from "./types";

// How much each agent CATEGORY is trusted to move a verdict. Verification votes directly;
// quantitative meta (pooled effect sizes) is nearly as strong; deliberation (debate,
// research) is substantial; enrichers/retrieval mostly supply context. Fixed + documented.
const CATEGORY_WEIGHT: Readonly<Record<AgentCategory, number>> = {
  verification: 1.0,
  meta: 0.9,
  deliberation: 0.7,
  screening: 0.6,
  sources: 0.5,
  "bio-kg": 0.5,
  retrieval: 0.4,
  enricher: 0.3,
};

function categoryWeight(category: AgentCategory): number {
  return CATEGORY_WEIGHT[category] ?? 0.5;
}

export interface WeightedContribution {
  agentId: string;
  name: string;
  category: AgentCategory;
  gate: number;
  contribution: AgentContribution;
}

export type MoaVerdict = "supported" | "refuted" | "mixed" | "insufficient";

export interface MoaAggregate {
  verdict: MoaVerdict;
  trust: number;
  mass: { supports: number; refutes: number; mixed: number };
  agreement: number;
  counts: { voted: number; ran: number; total: number };
  weights: Array<{ agentId: string; signal: AgentSignal; weight: number }>;
}

const VOTES: ReadonlySet<AgentSignal> = new Set(["supports", "refutes", "mixed"]);

const DOMINANCE = 0.6;
const CONTEST = 0.3;

/**
 * Deterministically mix weighted agent votes into a verdict + trust score. Pure: no I/O,
 * no LLM, inputs never mutated. Honest "insufficient" when nothing voted.
 */
export function aggregate(weighted: readonly WeightedContribution[]): MoaAggregate {
  const weights: MoaAggregate["weights"] = [];
  let supports = 0;
  let refutes = 0;
  let mixed = 0;
  let voted = 0;
  let ran = 0;
  let qualityMult = 1;

  for (const w of weighted) {
    const c = w.contribution;
    if (c.ran) ran += 1;

    const weight = clamp01(w.gate) * clamp01(c.confidence) * categoryWeight(w.category);

    if (VOTES.has(c.signal) && c.ran) {
      voted += 1;
      weights.push({ agentId: w.agentId, signal: c.signal, weight });
      if (c.signal === "supports") supports += weight;
      else if (c.signal === "refutes") refutes += weight;
      else mixed += weight;
    }

    const q = c.detail?.["qualityWeight"];
    if (typeof q === "number" && Number.isFinite(q)) {
      qualityMult = clamp01(q) * 0.5 + 0.5;
    }
  }

  const directional = supports + refutes + mixed;
  const total = weighted.length;

  if (directional === 0) {
    return {
      verdict: "insufficient",
      trust: 0,
      mass: { supports, refutes, mixed },
      agreement: 0,
      counts: { voted, ran, total },
      weights,
    };
  }

  const supportRatio = supports / directional;
  const refuteRatio = refutes / directional;
  const dominant = Math.max(supports, refutes);
  const loser = Math.min(supports, refutes);
  const agreement = dominant / directional;

  let verdict: MoaVerdict;
  const contested = loser / directional >= CONTEST;
  if (mixed / directional >= 0.5 || contested) {
    verdict = "mixed";
  } else if (supportRatio >= DOMINANCE && supports >= refutes) {
    verdict = "supported";
  } else if (refuteRatio >= DOMINANCE && refutes > supports) {
    verdict = "refuted";
  } else {
    verdict = "mixed";
  }

  const evidenceStrength = 1 - Math.exp(-directional);

  let trust: number;
  if (verdict === "mixed") {
    trust = Math.round(45 * agreement * evidenceStrength * qualityMult);
  } else {
    trust = Math.round(100 * agreement * evidenceStrength * qualityMult);
  }
  trust = Math.max(0, Math.min(100, trust));

  return {
    verdict,
    trust,
    mass: { supports: round4(supports), refutes: round4(refutes), mixed: round4(mixed) },
    agreement: round4(agreement),
    counts: { voted, ran, total },
    weights: weights.map((w) => ({ ...w, weight: round4(w.weight) })),
  };
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

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
  // Relative authority of this agent (MoaAgent.authority, default 1). Multiplies the vote weight
  // so an authoritative expert dominates a crowd of weaker agents.
  authority: number;
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

// The SINGLE agent allowed to set the global quality multiplier. `quality` is a first-class
// artifact PRODUCED only by paper-qa (see types.ts ArtifactKind "quality" + registry.ts).
// Reading the multiplier from exactly one producer closes three composition hazards:
//   1. verifiers already fold each source's own quality weight into their per-label
//      confidence upstream — so any second per-source quality signal reaching the mix would
//      DOUBLE-COUNT quality; only paper-qa's *collective* meanWeight belongs at the global
//      level, and nothing else may inject a competing per-source weight here;
//   2. an overwrite bug: reading `qualityWeight` from every contribution let the LAST one in
//      the array silently win; pinning the producer makes the multiplier deterministic
//      regardless of agent ordering;
//   3. an implicit dependency: any verifier that put `qualityWeight` in `detail` for tracing
//      would accidentally move the trust score. The contract is now explicit — only this id.
const QUALITY_PRODUCER_ID = "paperqa";

// Map paper-qa's collective meanWeight in [0,1] to a gentle global trust multiplier in
// [0.5,1]. A floor of 0.5 keeps low-tier bodies of evidence from collapsing to 0 while still
// rewarding high-quality evidence. Kept identical to the prior formula for stability.
function qualityMultiplierFrom(meanQualityWeight: number): number {
  return clamp01(meanQualityWeight) * 0.5 + 0.5;
}

// Read the global quality multiplier from EXACTLY the producer of the `quality` artifact.
// Verifier `detail` fields (even ones that happen to carry a `qualityWeight` for tracing)
// are ignored, so they can neither overwrite nor double-apply the multiplier.
function readQualityMult(weighted: readonly WeightedContribution[]): number {
  const producer = weighted.find((w) => w.agentId === QUALITY_PRODUCER_ID);
  const q = producer?.contribution.detail?.["qualityWeight"];
  if (typeof q === "number" && Number.isFinite(q)) {
    return qualityMultiplierFrom(q);
  }
  return 1;
}

// Minimum authority for an agent to act as the "lead verifier" the mixture defers to.
const LEAD_AUTHORITY_MIN = 2;

// The lead verifier: the highest-authority verification agent that actually ran. This is the
// mixture's most trusted expert (the primary-source auditor). Returns undefined when no such
// agent ran (e.g. the LLM API is down) — in which case the full deterministic mix decides.
function leadVerifier(
  weighted: readonly WeightedContribution[]
): WeightedContribution | undefined {
  const candidates = weighted.filter(
    (w) =>
      w.contribution.ran &&
      w.category === "verification" &&
      (Number.isFinite(w.authority) ? w.authority : 1) >= LEAD_AUTHORITY_MIN &&
      w.gate > 0
  );
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => b.authority * b.gate - a.authority * a.gate)[0];
}

// True when genuine CROSS-SOURCE evidence exists: a confident directional vote from an agent that
// only fires on >=2 sources (MultiVerS label aggregation or PyMARE effect-size pooling). When it
// does, the claim is multi-source and the full composition — not the single-primary-source
// auditor — should decide, so we do NOT defer to the lead.
function crossSourceConsensusPresent(weighted: readonly WeightedContribution[]): boolean {
  return weighted.some(
    (w) =>
      w.contribution.ran &&
      (w.agentId === "multivers" || w.agentId === "pymare") &&
      (w.contribution.signal === "supports" || w.contribution.signal === "refutes") &&
      w.contribution.confidence > 0.3
  );
}

function signalToVerdict(signal: AgentSignal): MoaVerdict {
  if (signal === "supports") return "supported";
  if (signal === "refutes") return "refuted";
  if (signal === "mixed") return "mixed";
  return "insufficient"; // insufficient | neutral
}

// Build the aggregate by DEFERRING to the lead verifier's verdict: a mixture of EXPERTS must not
// let a crowd of weaker agents out-vote its most authoritative one. The lead's own confidence sets
// the trust (tempered by the global quality multiplier); the other agents' vote masses are still
// reported for the trace but do not change the categorical verdict.
function deferToLead(
  lead: WeightedContribution,
  mass: { supports: number; refutes: number; mixed: number },
  counts: { voted: number; ran: number; total: number },
  weights: MoaAggregate["weights"],
  qualityMult: number
): MoaAggregate {
  const c = lead.contribution;
  const verdict = signalToVerdict(c.signal);
  const base = verdict === "insufficient" ? 15 : verdict === "mixed" ? 45 : 100;
  const trust = Math.max(0, Math.min(100, Math.round(base * clamp01(c.confidence) * qualityMult)));
  return {
    verdict,
    trust,
    mass: { supports: round4(mass.supports), refutes: round4(mass.refutes), mixed: round4(mass.mixed) },
    agreement: round4(clamp01(c.confidence)),
    counts,
    weights: weights.map((w) => ({ ...w, weight: round4(w.weight) })),
  };
}

/**
 * Deterministically mix weighted agent votes into a verdict + trust score. Pure: no I/O,
 * no LLM, inputs never mutated. Honest "insufficient" when nothing voted.
 *
 * Two regimes, both deterministic: (1) on a SINGLE-source claim, when the high-authority verifier
 * ran, DEFER to that lead expert's verdict (the mixture inherits the primary-source auditor's
 * accuracy instead of diluting it); (2) otherwise mix all votes — the multi-source composition
 * (where cross-source agents outweigh a single-source audit) or the resilience floor when the
 * LLM-based lead could not run. `sourceCount` gates regime (1): deferring to a one-source audit is
 * only correct when there IS one source; on multi-source it wrongly overrode cross-source consensus.
 */
export function aggregate(
  weighted: readonly WeightedContribution[],
  opts: { sourceCount?: number } = {}
): MoaAggregate {
  const weights: MoaAggregate["weights"] = [];
  let supports = 0;
  let refutes = 0;
  let mixed = 0;
  let voted = 0;
  let ran = 0;

  // Global quality multiplier: read ONCE from the sole `quality` producer (paper-qa), before
  // the vote loop and independent of iteration order. See QUALITY_PRODUCER_ID above.
  const qualityMult = readQualityMult(weighted);

  for (const w of weighted) {
    const c = w.contribution;
    if (c.ran) ran += 1;

    // Authority does NOT amplify the mix weight — that let one agent (the primary-source auditor)
    // dominate MULTI-source claims wrongly, overriding cross-source consensus. Authority is used
    // ONLY to pick the lead verifier for single-source deference below.
    const weight = clamp01(w.gate) * clamp01(c.confidence) * categoryWeight(w.category);

    if (VOTES.has(c.signal) && c.ran) {
      voted += 1;
      weights.push({ agentId: w.agentId, signal: c.signal, weight });
      if (c.signal === "supports") supports += weight;
      else if (c.signal === "refutes") refutes += weight;
      else mixed += weight;
    }
  }

  const total = weighted.length;

  // Regime 1 — LEAD-VERIFIER DEFERENCE. Only on a SINGLE-source claim (a one-source primary audit
  // must not override cross-source consensus on multi-source claims), and only when no cross-source
  // agent nonetheless voted. When the authoritative auditor ran, its verdict IS the verdict.
  const singleSource = (opts.sourceCount ?? 1) <= 1;
  const lead = leadVerifier(weighted);
  if (singleSource && lead && !crossSourceConsensusPresent(weighted)) {
    return deferToLead(
      lead,
      { supports, refutes, mixed },
      { voted, ran, total },
      weights,
      qualityMult
    );
  }

  // Regime 2 — full deterministic mix (multi-source, or the lead was unavailable).
  const directional = supports + refutes + mixed;

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

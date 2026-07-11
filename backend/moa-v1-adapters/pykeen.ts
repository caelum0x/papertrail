// MoA expert adapter — PyKEEN (category: bio-kg). A native TypeScript mirror of PyKEEN's
// TransE link predictor, exposed as an interchangeable "expert" agent.
//
// PyKEEN here is a LEARNED KNOWLEDGE-GRAPH LINK PREDICTOR: given a source entity already
// present in an org's knowledge graph, it ranks candidate NOVEL links by the deterministic
// TransE translation distance ||h + r - t|| over embeddings trained on kg_edges (see
// lib/kg/learnedLinkPredict.ts, mirrored in backend/engines/pykeen/papertrail_train.py).
//
// Why this expert gates 0 on the plain-claim path (honest Mixture-of-Experts behavior):
//   - The engine is FUNDAMENTALLY STATEFUL. Every scorable step needs a DB pool: it loads
//     (or trains-on-demand) embeddings from kg_embeddings, resolves the source entity via
//     getNodeByNormalizedId, and gathers candidates with a bounded BFS over kg_edges. None
//     of that can run statelessly — the orchestrator is stateless and MUST NOT open a pool.
//   - The OrchestrationContext carries only { claim, sources, options }. It never carries a
//     built KG, a normalized source-entity id, or a pool. A plain claim + free-text sources
//     give this predictor nothing to translate over, so there is no deterministic signal to
//     produce and NO learned vector to ground against.
//
// Therefore gate(ctx) is a HONEST 0 for the plain-claim path: PyKEEN never runs in the
// stateless MoA pipeline, and run() returns a clear skippedContribution rather than
// inventing a pool or fabricating a link. Registering the adapter keeps PyKEEN a first-class
// expert so it can fire once the pipeline is extended to supply built-KG context.
//
// No Claude anywhere: the underlying scorer is pure deterministic math with no LLM in any
// score or in training, so run() never invokes Claude (usedClaude is always false).

import type { Expert, OrchestrationContext, ExpertContribution } from "../types";
import { skippedContribution } from "../types";

const EXPERT_ID = "pykeen";

// The single, honest reason PyKEEN cannot participate statelessly. Surfaced verbatim so the
// UI trace explains WHY this expert abstained (missing built KG) instead of silently dropping.
const SKIP_REASON = "needs a built knowledge graph — run via Knowledge Graph";

const expert: Expert = {
  id: EXPERT_ID,
  name: "PyKEEN learned link predictor",
  category: "bio-kg",
  description:
    "Ranks novel knowledge-graph links from a source entity by deterministic TransE " +
    "distance over embeddings trained on the org KG. Requires a built knowledge graph " +
    "and a DB pool, so it abstains on the stateless plain-claim path.",

  // Pure + deterministic. The stateless context never carries a built KG, a normalized
  // source-entity id, or a pool — everything this engine needs to score — so the engine is
  // never applicable here. Honest 0: PyKEEN belongs to the Knowledge Graph path, not the
  // plain-claim MoA path. No I/O, no LLM, no throwing.
  gate(_ctx: OrchestrationContext): number {
    return 0;
  },

  // gate is always 0, so the router never selects this expert. If it is ever invoked
  // directly, return an honest skip — never open a DB pool, never fetch, never fabricate a
  // link. This is a stateless, side-effect-free no-op vote.
  async run(_ctx: OrchestrationContext): Promise<ExpertContribution> {
    return skippedContribution(EXPERT_ID, SKIP_REASON);
  },
};

export default expert;

// PaperTrail MoA v2 — PyKEEN learned link predictor (category: bio-kg).
//
// COMPOSITION ROLE: none on the stateless plain-claim path. PyKEEN is a LEARNED
// knowledge-graph link predictor: given a source entity already present in an org's
// knowledge graph, it ranks candidate NOVEL links by the deterministic TransE translation
// distance ||h + r - t|| over embeddings trained on the org's KG edges (mirrored in
// backend/engines/pykeen/papertrail_train.py; TS mirror in lib/kg/learnedLinkPredict.ts).
//
// Why this agent PRODUCES nothing and CONSUMES nothing (honest Mixture-of-Agents skip):
//   - The engine is FUNDAMENTALLY STATEFUL. Every scorable step needs a DB pool: it loads
//     (or trains-on-demand) embeddings from kg_embeddings, resolves the source entity via
//     the KG node index, and gathers candidates with a bounded BFS over kg_edges. None of
//     that can run inside a stateless MoA agent — the scheduler MUST NOT open a pool.
//   - The OrchestrationContext carries only { claim, sources, options }. It never carries a
//     built KG, a normalized source-entity id, or a pool. A plain claim + free-text sources
//     give this predictor nothing to translate over, so there is NO deterministic signal to
//     produce and NO learned vector to ground against — nothing to write to the blackboard,
//     and no upstream artifact this predictor could compose on to change that.
//
// Therefore gate(ctx) is an HONEST 0 for the plain-claim path: PyKEEN never runs in the
// stateless composition pipeline, and run() returns a clear skippedContribution rather than
// inventing a pool or fabricating a link. Registering the agent keeps PyKEEN a first-class
// bio-kg expert so it can fire once the pipeline is extended to supply built-KG context.
//
// MOAT: no LLM anywhere — the underlying scorer is pure deterministic math with no Claude in
// any score or in training, so run() never invokes Claude (usedClaude is always false). No
// DB pool, no network, no I/O: this is a stateless, side-effect-free no-op vote.
//
// This UPGRADES backend/moa-v1-adapters/pykeen.ts to the v2 composition contract: the same
// honest-skip behavior, now expressed with produces/consumes and the (ctx, bb) run signature.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
} from "../types";
import { skippedContribution } from "../types";

const AGENT_ID = "pykeen";

// The single, honest reason PyKEEN cannot participate statelessly. Surfaced verbatim so the
// UI trace explains WHY this agent abstained (missing built KG) instead of silently dropping.
const SKIP_REASON = "needs a built knowledge graph — run via Knowledge Graph";

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "PyKEEN learned link predictor",
  category: "bio-kg",
  description:
    "Ranks novel knowledge-graph links from a source entity by deterministic TransE " +
    "distance over embeddings trained on the org KG. Requires a built knowledge graph and " +
    "a DB pool, so it abstains on the stateless plain-claim path.",

  // Produces no artifact: with no built KG in the stateless context there is nothing to write.
  produces: [] as const,
  // Consumes no artifact: no upstream enricher can supply a trained KG or a pool, so there is
  // nothing on the blackboard this predictor could compose on to become applicable.
  consumes: [] as const,

  // ELIGIBILITY: pure + deterministic over the INPUT only. The stateless context never carries
  // a built KG, a normalized source-entity id, or a pool — everything this engine needs to
  // score — so the engine is never applicable here. Honest 0: PyKEEN belongs to the Knowledge
  // Graph path, not the plain-claim MoA path. No blackboard, no I/O, no LLM, never throws.
  gate(_ctx: OrchestrationContext): number {
    return 0;
  },

  // gate is always 0, so the scheduler never selects this agent. If it is ever invoked
  // directly, return an honest skip — never open a DB pool, never fetch, never fabricate a
  // link, never read the blackboard (there is nothing here for it to consume). This is a
  // stateless, side-effect-free no-op vote that produces no artifact.
  async run(_ctx: OrchestrationContext, _bb: Blackboard): Promise<AgentContribution> {
    return skippedContribution(AGENT_ID, SKIP_REASON);
  },
};

export default agent;

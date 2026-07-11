// PaperTrail MoA v2 agent · Evidence Integrator (FAERS / ClinVar / ChEMBL) (category: sources).
//
// WHAT THIS ENGINE CLUSTER WOULD CONTRIBUTE: a live pharmacovigilance / variant / bioactivity
// INGEST signal. The FAERS, ClinVar and ChEMBL drivers in lib/ingest/drivers/* each perform a
// LIVE outbound HTTP fetch to a third-party database (openFDA FAERS adverse-event counts, NCBI
// ClinVar variant significance, ChEMBL molecule bioactivity) and write cacheable source records.
// That is data INGESTION, not stateless claim verification: its unit of work is a (drug, event) /
// variant / molecule lookup keyed off ingest context, not the (claim, sources) pair the MoA
// orchestrator hands an agent. Its results are meant to be persisted to the `sources` cache and
// then fed back into the pipeline as ordinary MoaSources — at which point OTHER agents read them.
//
// WHY IT DOES NOT COMPOSE STATELESSLY (honest Mixture-of-Agents skip):
//   The orchestrate path is explicitly STATELESS: no DB pool, and no network beyond what an
//   engine lib already does internally for a pure verification step. A live FAERS/ClinVar/ChEMBL
//   fetch from inside run() would violate that contract and make the deterministic mix depend on
//   external API latency/availability. There is no way to compute an adverse-event / variant /
//   bioactivity signal PURELY from the fields already present on a MoaSource, and no upstream
//   blackboard artifact supplies one. So this agent invents no fetch and no pool: it neither
//   PRODUCES nor CONSUMES an artifact. It stays REGISTERED (so the router lists the cluster and a
//   Source Ingest path can attach evidence later) while gating to 0 on the orchestrate path.
//
// COMPOSITION WIRING: produces [] and consumes [] — evidence-integrator is a leaf in the DAG. It
// reads no upstream artifact and writes none, so the scheduler places it in the root layer where
// it immediately skips. Stateless / deterministic / no LLM / no I/O: gate is the constant 0 (a
// live ingest fetch the stateless path cannot perform and no artifact supplies), run never touches
// the network or the blackboard, never invokes Claude (usedClaude is always false), never throws.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
} from "../types";
import { skippedContribution, erroredContribution } from "../types";

const AGENT_ID = "evidence-integrator";

// The one honest reason surfaced whenever this agent is (never) run on the orchestrate path.
// Kept as a constant so the gate rationale and the skip message stay in lock-step.
const SKIP_REASON = "live FAERS/ClinVar/ChEMBL lookup — run via Source Ingest";

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "Evidence Integrator (FAERS / ClinVar / ChEMBL)",
  category: "sources",
  description:
    "Live pharmacovigilance / variant / bioactivity ingest (FAERS, ClinVar, ChEMBL). These " +
    "drivers perform outbound network fetch + caching and are ingestion, not stateless claim " +
    "verification, so this agent is registered but always gates 0 on the orchestrate path — it " +
    "is run via Source Ingest, not the MoA mix.",

  // Produces + consumes nothing: an ingest signal needs a live FAERS/ClinVar/ChEMBL fetch and a
  // source cache the stateless orchestrator has no artifact for. Leaf node in the composition DAG.
  produces: [],
  consumes: [],

  // DETERMINISTIC and constant. This engine cluster fundamentally needs live network I/O and a
  // source cache the stateless orchestrator does not provide, so it must never run in the
  // orchestrate path. A pure 0 keeps it REGISTERED (visible to the router/registry) while
  // guaranteeing the scheduler never schedules it; per the router contract a planner boost can
  // lift a low gate but can never revive a gate of exactly 0 — exactly what an ingestion engine
  // with no stateless verification mode wants. Pure, side-effect-free, never throws.
  gate(_ctx: OrchestrationContext): number {
    return 0;
  },

  // Never reached on the orchestrate path (gate is 0). Guarded anyway: if a caller invokes run()
  // directly, it degrades to an honest, network-free skip rather than attempting the live
  // FAERS/ClinVar/ChEMBL fetch, which belongs to the Source Ingest entry point. Nothing is
  // produced or consumed; usedClaude stays false; no support/refute vote is cast.
  async run(_ctx: OrchestrationContext, _bb: Blackboard): Promise<AgentContribution> {
    try {
      return skippedContribution(AGENT_ID, SKIP_REASON);
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;

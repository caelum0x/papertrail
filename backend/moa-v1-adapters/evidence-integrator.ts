// PaperTrail MoA expert · Evidence Integrator (category: sources) — REGISTRATION-ONLY.
//
// The evidence-integrator cluster is PaperTrail's live pharmacovigilance / variant /
// bioactivity ingest layer: the FAERS, ClinVar and ChEMBL drivers in
// lib/ingest/drivers/*. Each driver's fetch() performs a LIVE network call to an
// external database (openFDA FAERS, NCBI ClinVar, ChEMBL) and writes a cacheable
// source record. That is data INGESTION, not stateless claim verification:
//
//   - It requires live outbound I/O to third-party APIs (assessSafetySignal, etc.).
//   - Its unit of work is (drug, event) / variant / molecule lookups keyed off ingest
//     context, not the (claim, sources) pair the MoA orchestrator hands an expert.
//   - Its results are meant to be persisted to the `sources` cache and then fed back
//     into the pipeline as ordinary MoaSources — at which point OTHER experts read them.
//
// The MoA orchestrate path is explicitly STATELESS: no DB pool, and no network beyond
// what an engine lib already does internally for a pure verification step. Doing a live
// FAERS/ClinVar/ChEMBL fetch from inside run() would violate that contract and make the
// deterministic mix depend on external API latency/availability. So the correct
// Mixture-of-Experts behavior is to REGISTER this engine cluster (so it is visible in the
// registry/trace) while gating it to 0 on the orchestrate path and returning an honest
// skip that points operators at the real entry point (Source Ingest).
//
// Consequences of registration-only:
//   - gate() is a pure constant 0 — this expert never runs in orchestrate.
//   - run() never touches the network, never uses a DB pool, and never invokes Claude.
//     It returns skippedContribution with a clear one-line reason. usedClaude is false.
//   - signal is `insufficient` (via skippedContribution): it casts no support/refute vote.

import type { Expert, OrchestrationContext, ExpertContribution } from "../types";
import { skippedContribution } from "../types";

const EXPERT_ID = "evidence-integrator";

// The one honest reason surfaced whenever this expert is (never) run on the orchestrate
// path. Kept as a constant so the gate rationale and the skip message stay in lock-step.
const SKIP_REASON =
  "live FAERS/ClinVar/ChEMBL lookup — run via Source Ingest";

const expert: Expert = {
  id: EXPERT_ID,
  name: "Evidence Integrator (FAERS / ClinVar / ChEMBL)",
  category: "sources",
  description:
    "Live pharmacovigilance / variant / bioactivity ingest (FAERS, ClinVar, ChEMBL). These drivers perform outbound network fetch + caching and are ingestion, not stateless claim verification, so this expert is registered but always gates 0 on the orchestrate path — it is run via Source Ingest, not the MoA mix.",

  // DETERMINISTIC and constant: this engine cluster fundamentally needs live network I/O
  // and a source cache the stateless orchestrator does not provide, so it must never run
  // in the orchestrate path. A pure 0 keeps it registered (visible to the router) while
  // guaranteeing the router never schedules it. A planner boost can lift a low gate but
  // (per the router contract) can never revive a gate of exactly 0 — which is what we want
  // for an ingestion engine that has no stateless verification mode.
  gate(_ctx: OrchestrationContext): number {
    return 0;
  },

  // Never reached on the orchestrate path (gate is 0). Guarded anyway: if a caller invokes
  // run() directly, it degrades to an honest, network-free skip rather than attempting the
  // live FAERS/ClinVar/ChEMBL fetch, which belongs to the Source Ingest entry point.
  async run(_ctx: OrchestrationContext): Promise<ExpertContribution> {
    return skippedContribution(EXPERT_ID, SKIP_REASON);
  },
};

export default expert;

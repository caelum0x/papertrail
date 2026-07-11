// PaperTrail MoA v2 agent · pyalex CITATION VELOCITY (category: sources).
//
// WHAT THIS ENGINE WOULD CONTRIBUTE: a living-evidence WEIGHTING signal — is a primary
// source's evidence base still MOVING? The pyalex specialization
// (backend/engines/pyalex/pyalex/papertrail_citation_velocity.py::citation_velocity)
// reads a work's per-year `counts_by_year` from OpenAlex and labels the trend
// (accelerating / decelerating / steady). A rising velocity means the question is still
// actively contested and a pooled verdict may still flip; a flat/falling one means the
// field has settled. That is CONTEXT/weighting, never a support/refute vote.
//
// WHY IT DOES NOT COMPOSE STATELESSLY (honest Mixture-of-Agents skip):
//   citation_velocity is a LIVE OpenAlex HTTP GET keyed by an OpenAlex work id or DOI
//   (it fetches `counts_by_year`). The stateless orchestrator provides NO network fetch
//   and NO per-year velocity data on a MoaSource — `MoaSource` carries `doi`/`citations`/
//   `year`, but a single lifetime `citations` count is NOT a velocity (it has no per-year
//   shape and no trend). There is no way to compute velocity PURELY from the fields already
//   present, so this agent does not invent a fetch or a pool, and it neither PRODUCES nor
//   CONSUMES a blackboard artifact. It stays REGISTERED (so the router still lists it and a
//   Living Evidence ingestion path can attach per-year velocity later), but in the plain
//   orchestrate case it returns an honest skip.
//
// COMPOSITION WIRING: produces [] and consumes [] — pyalex is a leaf in the DAG. It reads
// no upstream artifact and writes none, so the scheduler places it in the root layer where
// it immediately skips. Stateless / deterministic / no LLM / no I/O: gate is the constant 0
// (velocity always needs a live fetch the stateless path cannot perform), run never touches
// the blackboard, never calls Claude (usedClaude is always false), and never throws.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  MoaSource,
} from "../types";
import { skippedContribution, erroredContribution } from "../types";

const AGENT_ID = "pyalex";

// A source is "velocity-addressable" only if it carries a stable identifier pyalex could
// resolve against OpenAlex (a DOI, or an OpenAlex work id "W…"). Lifetime `citations` alone
// is NOT enough — velocity needs the per-year `counts_by_year` shape a live fetch returns,
// which the stateless context does not provide. Used only for the honest detail line; it
// never changes the outcome, which is always a skip.
function velocityIdentifier(source: MoaSource): string | null {
  const doi = source.doi?.trim();
  if (doi !== undefined && doi.length > 0) return doi;
  // OpenAlex work ids sometimes arrive on the url (e.g. https://openalex.org/W123…).
  const url = source.url?.trim();
  if (url !== undefined && /(?:^|\/)W\d+$/i.test(url)) return url;
  return null;
}

// Count of sources that at least COULD be velocity-queried (have a resolvable id).
function addressableCount(sources: readonly MoaSource[]): number {
  return sources.reduce(
    (n, s) => (velocityIdentifier(s) !== null ? n + 1 : n),
    0
  );
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "pyalex citation-velocity monitor",
  category: "sources",
  description:
    "Living-evidence weighting: labels whether a primary source's citation velocity is " +
    "accelerating / decelerating / steady (is the question still contested?). Needs a live " +
    "OpenAlex fetch keyed by DOI, so it only fires via the Living Evidence ingestion path; " +
    "in the stateless orchestrate path it skips. Weights context; casts no support/refute vote.",

  // Produces + consumes nothing: velocity needs a live OpenAlex fetch and per-year data the
  // stateless blackboard has no artifact for. Leaf node in the composition DAG.
  produces: [],
  consumes: [],

  // Pure, deterministic, no I/O, never throws. Citation velocity fundamentally requires a
  // live OpenAlex fetch (`counts_by_year`) the stateless orchestrator cannot perform and no
  // upstream artifact supplies, so this agent can never vote in this path: gate is 0. It stays
  // REGISTERED via the router/registry, not via a non-zero gate — the honest MoA skip.
  gate(_ctx: OrchestrationContext): number {
    return 0;
  },

  async run(ctx: OrchestrationContext, _bb: Blackboard): Promise<AgentContribution> {
    try {
      // Honest MoA skip. Citation velocity requires a live OpenAlex GET (per-year
      // `counts_by_year`) keyed by DOI/work id — the stateless orchestrate path provides
      // neither the fetch nor the per-year data on a MoaSource, and no blackboard artifact
      // carries it. We refuse to invent a pool or a network call, so we do not vote. Not an
      // error, and nothing is produced or consumed.
      const addressable = addressableCount(ctx.sources);
      const summary =
        addressable > 0
          ? `Found ${addressable} source(s) with a resolvable DOI/OpenAlex id, but citation ` +
            "velocity needs OpenAlex ingestion context — run via Living Evidence."
          : `Checked ${ctx.sources.length} source(s); none carried a resolvable DOI or ` +
            "OpenAlex id. Citation velocity requires OpenAlex ingestion context — run via " +
            "Living Evidence.";
      return skippedContribution(AGENT_ID, summary);
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;

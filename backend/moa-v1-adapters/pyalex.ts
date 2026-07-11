// PaperTrail MoA expert adapter — pyalex CITATION VELOCITY (category: sources).
//
// WHAT THIS ENGINE CONTRIBUTES: a living-evidence WEIGHTING signal — is a primary
// source's evidence base still MOVING? The pyalex specialization
// (backend/engines/pyalex/pyalex/papertrail_citation_velocity.py::citation_velocity)
// reads a work's per-year `counts_by_year` from OpenAlex and labels the trend
// (accelerating / decelerating / steady). A rising velocity means the question is
// still actively contested and a pooled verdict may still flip; a flat/falling one
// means the field has settled. That is CONTEXT/weighting, never a support/refute
// vote — so the signal, on the rare occasion this runs, is always `neutral`.
//
// WHY IT GATES ~0 IN THE ORCHESTRATE PATH (honest Mixture-of-Experts skip):
//   citation_velocity is a LIVE OpenAlex HTTP GET keyed by an OpenAlex work id or DOI
//   (it fetches `counts_by_year`). The stateless orchestrator provides NO network fetch
//   and NO per-year velocity data on a MoaSource — `MoaSource` carries `doi`/`citations`
//   /`year`, but a single lifetime `citations` count is NOT a velocity (it has no
//   per-year shape and no trend). There is no way to compute velocity PURELY from the
//   fields already present, so this adapter does not invent a fetch or a pool. It stays
//   REGISTERED (so it fires the moment velocity is provided via the Living Evidence
//   ingestion path) but returns an honest skip in the plain-claim orchestrate case.
//
// STATELESS / DETERMINISTIC / NO LLM: gate is a pure DOI-presence check; run never
// performs I/O and never calls Claude (usedClaude is always false).

import type {
  Expert,
  OrchestrationContext,
  ExpertContribution,
  MoaSource,
} from "../types";
import { skippedContribution, erroredContribution, clamp01 } from "../types";

const EXPERT_ID = "pyalex";

// A source is "velocity-addressable" only if it carries a stable identifier pyalex could
// resolve against OpenAlex (a DOI, or an OpenAlex work id "W…"). Lifetime `citations`
// alone is NOT enough — velocity needs the per-year `counts_by_year` shape a live fetch
// returns, which the stateless context does not provide.
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

const expert: Expert = {
  id: EXPERT_ID,
  name: "pyalex citation-velocity monitor",
  category: "sources",
  description:
    "Living-evidence weighting: labels whether a primary source's citation velocity is " +
    "accelerating / decelerating / steady (is the question still contested?). Needs a live " +
    "OpenAlex fetch keyed by DOI, so it only fires via the Living Evidence ingestion path; " +
    "in the stateless orchestrate path it skips. Weights context; casts no support/refute vote.",

  // Pure + deterministic, no I/O, never throws. Velocity fundamentally needs a live
  // OpenAlex fetch the stateless orchestrator cannot perform, so:
  //   - 0 when NO source carries a resolvable DOI / OpenAlex id (never applicable), and
  //   - a LOW, non-zero gate when at least one source IS velocity-addressable — this is
  //     the honest "could run if the Living Evidence ingestion context were provided
  //     later" signal, kept low because run() will still skip until that data exists.
  // A low gate (not 0) keeps the engine REGISTERED and lets a planner boost it once the
  // ingestion path actually attaches per-year velocity data.
  gate(ctx: OrchestrationContext): number {
    const addressable = addressableCount(ctx.sources);
    if (addressable === 0) return 0;
    // Small, bounded relevance: enough to register + be boostable, low enough that a
    // deterministic aggregator never leans on an expert that cannot vote statelessly.
    return clamp01(0.1);
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    try {
      const addressable = addressableCount(ctx.sources);

      // Honest MoE skip. Citation velocity requires a live OpenAlex GET (per-year
      // `counts_by_year`) keyed by DOI/work id — the stateless orchestrate path provides
      // neither the fetch nor the per-year data on a MoaSource. We refuse to invent a
      // pool or a network call, so we do not vote. Not an error.
      if (addressable === 0) {
        return skippedContribution(
          EXPERT_ID,
          "No source carries a DOI/OpenAlex id, and no per-year velocity data is present — " +
            "needs OpenAlex ingestion context (run via Living Evidence)."
        );
      }

      return skippedContribution(
        EXPERT_ID,
        `Found ${addressable} source(s) with a resolvable DOI/OpenAlex id, but citation ` +
          "velocity needs a live OpenAlex fetch — needs OpenAlex ingestion context (run via Living Evidence)."
      );
    } catch (err: unknown) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;

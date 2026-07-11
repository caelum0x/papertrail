// PaperTrail MoA v2 agent · MultiVerS cross-source aggregation VERIFIER.
//
// THE COMPOSITION FIX. MultiVerS scores ONE {claim, abstract} pair at a time and emits a
// single SUPPORTS/REFUTES/NEI label per source; it never combines those per-source labels
// into a claim-level verdict. lib/scieval/crossSourceAggregate.ts is that missing native
// aggregation step. In v1 this adapter re-read labels off each MoaSource.label — but that
// is not composition, it is duplicated upstream work. In v2 it CONSUMES the `source_labels`
// artifact that MiniCheck PRODUCES on the blackboard and aggregates THOSE. It creates no
// labels of its own; it builds on the upstream labeler.
//
// CONSUMES:
//   - source_labels (REQUIRED)  — MiniCheck's per-source SUPPORTS/REFUTES/NEI + confidence.
//                                 If absent or <2 labels, we skip honestly (nothing to
//                                 aggregate). This is the whole point of the DAG: this
//                                 verifier runs AFTER, and reads the output of, the labeler.
//   - quality       (OPTIONAL)  — paper-qa's per-source tier/weight. When present, each
//                                 source's label confidence is DOWN-WEIGHTED by its quality
//                                 weight so low-tier evidence contributes proportionally less
//                                 to the aggregate. When absent, labels aggregate at face
//                                 value (honest degrade, not an error).
//
// PRODUCES: nothing — this is a terminal verifier that only votes.
//
// DETERMINISM / MOAT: the entire run() path is pure — a single call into the LLM-free
// aggregateCrossSource() over labels the blackboard already holds. No network, no DB pool,
// no Claude. usedClaude is always false. groundedSpans stays empty: this verifier quotes
// nothing of its own (it consumes upstream labels and must not fabricate spans).

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  SourceLabel,
  SourceQuality,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import {
  aggregateCrossSource,
  type CrossSourceInput,
  type CrossSourceVerdict,
} from "../../scieval/crossSourceAggregate";
import type { AgentSignal } from "../types";

const AGENT_ID = "multivers";

// Minimum labeled sources for cross-source aggregation to be meaningful. One label is not an
// aggregation — it is just that source's verdict. Two is the first point at which agreement,
// conflict, and dominance can exist.
const MIN_LABELED_SOURCES = 2;

// Gate weight when the required input WILL exist. Eligibility is deterministic from the input:
// with >=2 sources, MiniCheck will produce >=2 labels for us to aggregate.
const GATE_ACTIVE = 0.7;

// Map the deterministic 4-way aggregate verdict onto the uniform AgentSignal.
function signalFromVerdict(verdict: CrossSourceVerdict): AgentSignal {
  switch (verdict) {
    case "supported":
      return "supports";
    case "refuted":
      return "refutes";
    case "mixed":
      return "mixed";
    case "insufficient":
      return "insufficient";
  }
}

// One safe UI line describing the aggregate.
function summarize(
  verdict: CrossSourceVerdict,
  supportCount: number,
  refuteCount: number,
  neiCount: number,
  qualityWeighted: boolean
): string {
  const tally = `${supportCount} support / ${refuteCount} refute / ${neiCount} no-info`;
  const suffix = qualityWeighted ? ", quality-weighted" : "";
  switch (verdict) {
    case "supported":
      return `Cross-source aggregate supports the claim (${tally}${suffix}).`;
    case "refuted":
      return `Cross-source aggregate refutes the claim (${tally}${suffix}).`;
    case "mixed":
      return `Labeled sources conflict with no dominant side (${tally}${suffix}).`;
    case "insufficient":
      return `Labeled sources give no directional evidence (${tally}${suffix}).`;
  }
}

// Map one upstream SourceLabel onto the aggregator's input shape. The label vocabulary
// ("SUPPORTS" | "REFUTES" | "NEI") is identical to CrossSourceLabel, so this is a pure
// rename. When a `quality` weight exists for the source, fold it into the label confidence
// (confidence * qualityWeight) so lower-tier evidence contributes proportionally less. The
// aggregator re-clamps to [0,1] internally, so this stays a safe, deterministic scaling.
function toCrossSourceInput(
  label: SourceLabel,
  quality: SourceQuality | undefined
): CrossSourceInput {
  const qualityWeight = quality?.weightById[label.sourceId]?.weight;
  const confidence =
    qualityWeight !== undefined
      ? clamp01(label.confidence * qualityWeight)
      : clamp01(label.confidence);
  return { id: label.sourceId, label: label.label, confidence };
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "MultiVerS Cross-Source Aggregator",
  category: "verification",
  description:
    "Verifier: consumes MiniCheck's per-source SUPPORTS/REFUTES/NEI labels from the " +
    "blackboard and aggregates them into one deterministic claim-level verdict, optionally " +
    "down-weighting each label by paper-qa's source quality. Creates no labels; only votes.",

  // Terminal verifier: produces no artifact. Consumes MiniCheck's labels (required) and
  // paper-qa's quality (optional) — so the scheduler runs it AFTER both.
  produces: [] as const,
  consumes: ["source_labels", "quality"] as const,

  // ELIGIBILITY (deterministic, input-only): with >=2 sources, MiniCheck will produce >=2
  // labels for this aggregator to combine. With <2 sources there is nothing to aggregate.
  // The gate never touches the blackboard (it runs before scheduling); the true "are the
  // labels actually here?" check happens in run() and degrades via skippedContribution.
  gate(ctx: OrchestrationContext): number {
    return ctx.sources.length >= MIN_LABELED_SOURCES ? GATE_ACTIVE : 0;
  },

  async run(
    ctx: OrchestrationContext,
    bb: Blackboard
  ): Promise<AgentContribution> {
    void ctx;
    try {
      // COMPOSE: read the labels MiniCheck produced upstream. This is the composition fix —
      // we aggregate the blackboard's labels, not labels re-derived from the raw input.
      const labels = bb.get("source_labels");

      // Honest runtime skip: the gate approved on eligibility, but if MiniCheck did not
      // actually produce (enough) labels, there is nothing to aggregate. Not an error.
      if (labels === undefined || labels.length < MIN_LABELED_SOURCES) {
        return skippedContribution(
          AGENT_ID,
          "No upstream labels to aggregate — MultiVerS needs at least two per-source SUPPORTS/REFUTES/NEI labels from the labeler."
        );
      }

      // OPTIONAL COMPOSE: fold in source quality if paper-qa produced it. Absent => face value.
      const quality = bb.get("quality");
      const qualityWeighted = quality !== undefined;

      const inputs: CrossSourceInput[] = labels.map((l) =>
        toCrossSourceInput(l, quality)
      );
      const aggregate = aggregateCrossSource(inputs);

      const signal = signalFromVerdict(aggregate.verdict);

      // Confidence is the magnitude of the deterministic net direction in [0,1]: a lopsided
      // verdict is confident; a mixed/insufficient one (netConfidence ~0) is honestly low.
      const confidence = clamp01(Math.abs(aggregate.netConfidence));

      // Provenance: which agent produced the labels we consumed (for the UI composition trace).
      const labelsProducer = bb.producerOf("source_labels");
      const qualityProducer = qualityWeighted
        ? bb.producerOf("quality")
        : undefined;

      // Detail = the auditable tally + counts + composition provenance. Ids/counts/scores
      // only — no source text, no secrets.
      const detail: Record<string, unknown> = {
        verdict: aggregate.verdict,
        supportCount: aggregate.supportCount,
        refuteCount: aggregate.refuteCount,
        neiCount: aggregate.neiCount,
        netConfidence: aggregate.netConfidence,
        netDirection: aggregate.netDirection,
        mixed: aggregate.mixed,
        consideredCount: aggregate.consideredCount,
        tally: {
          supportMass: aggregate.tally.supportMass,
          refuteMass: aggregate.tally.refuteMass,
          neiMass: aggregate.tally.neiMass,
        },
        qualityWeighted,
        // Composition trace: this verifier built on these upstream producers.
        consumedFrom: {
          source_labels: labelsProducer ?? null,
          quality: qualityProducer ?? null,
        },
      };

      return makeContribution(AGENT_ID, {
        ran: true,
        signal,
        confidence,
        summary: summarize(
          aggregate.verdict,
          aggregate.supportCount,
          aggregate.refuteCount,
          aggregate.neiCount,
          qualityWeighted
        ),
        detail,
        // Consumes upstream labels and quotes nothing of its own — never fabricate spans.
        groundedSpans: [],
        usedClaude: false,
        // Terminal verifier: produces no artifact.
        produced: {},
      });
    } catch (err) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;

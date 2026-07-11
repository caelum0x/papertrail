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
//   - design_priors (OPTIONAL)  — pytrials' per-source trial-design credibility. When present,
//                                 each trial source's label confidence is re-weighted by how
//                                 rigorous its design is (a SUPPORTS from a high-tier RCT should
//                                 count more than one from a very-low-tier design). The weight is
//                                 MEAN-PRESERVING and tightly clamped (see designMultiplier): it
//                                 redistributes weight AMONG the design-scored sources around
//                                 their own mean rather than inflating or deflating the aggregate,
//                                 so it sharpens the mix without moving the overall evidence mass.
//                                 Absent design_priors is an exact no-op (every multiplier is 1).
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
  DesignPrior,
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

// Bounds on the mean-preserving design-credibility multiplier. A trial source can contribute
// at most +/-25% relative to the mean design strength of the design-scored sources, so a strong
// RCT is sharpened up and a very-low design is nudged down WITHOUT any single source dominating
// or a whole verdict flipping on design alone. Tight by design: this is a refinement of the
// cross-source mix, not a second vote.
const DESIGN_MULT_MIN = 0.75;
const DESIGN_MULT_MAX = 1.25;

// Build a per-source design multiplier from pytrials' design_priors, normalized to the MEAN
// prior weight across the scored sources so the reweighting is mean-preserving (redistributes
// among design-scored sources rather than shifting the aggregate up or down). Sources without a
// design prior — non-trial evidence — always get 1.0 (untouched). Returns an all-1.0 behavior
// (empty map) when there are no priors, making the whole feature an exact no-op.
function buildDesignMultipliers(
  priors: DesignPrior[] | undefined
): Map<string, number> {
  const multipliers = new Map<string, number>();
  if (priors === undefined || priors.length === 0) return multipliers;

  const mean =
    priors.reduce((sum, p) => sum + p.priorWeight, 0) / priors.length;
  // Degenerate mean (all-zero priors) => no reweighting; avoid divide-by-zero.
  if (mean <= 0) return multipliers;

  for (const p of priors) {
    const raw = p.priorWeight / mean;
    const clamped = Math.min(DESIGN_MULT_MAX, Math.max(DESIGN_MULT_MIN, raw));
    multipliers.set(p.sourceId, clamped);
  }
  return multipliers;
}

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
    default:
      // Exhaustiveness guard: fail loud if CrossSourceVerdict ever expands. Better a visible
      // error than a silent `undefined` signal corrupting the deterministic aggregate.
      throw new Error(`Unexpected cross-source verdict: ${String(verdict)}`);
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
  quality: SourceQuality | undefined,
  designMultipliers: Map<string, number>
): CrossSourceInput {
  const qualityWeight = quality?.weightById[label.sourceId]?.weight;
  // Design multiplier defaults to 1 (no-op) for any source without a design prior.
  const designMult = designMultipliers.get(label.sourceId) ?? 1;
  const base =
    qualityWeight !== undefined
      ? label.confidence * qualityWeight
      : label.confidence;
  const confidence = clamp01(base * designMult);
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

  // Terminal verifier: produces no artifact. Consumes MiniCheck's labels (required),
  // paper-qa's quality (optional), and pytrials' design_priors (optional) — so the
  // scheduler runs it AFTER all of them.
  produces: [] as const,
  consumes: ["source_labels", "quality", "design_priors"] as const,

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

      // OPTIONAL COMPOSE: fold in trial-design credibility if pytrials produced it. The
      // multiplier is mean-preserving and clamped, so absent priors are an exact no-op.
      const designPriors = bb.get("design_priors");
      const designMultipliers = buildDesignMultipliers(designPriors);
      const designWeighted = designMultipliers.size > 0;

      const inputs: CrossSourceInput[] = labels.map((l) =>
        toCrossSourceInput(l, quality, designMultipliers)
      );
      const aggregate = aggregateCrossSource(inputs);

      // Representative scalar of the per-source quality weights this run actually applied, to
      // propagate to the aggregator's composition trace (detail.qualityWeight). The aggregator
      // reads its GLOBAL quality multiplier only from paper-qa's own contribution (see
      // aggregate.ts QUALITY_PRODUCER_ID), so this field is trace-only and cannot double-count
      // or move trust. When paper-qa's quality is absent every label folds in at face value,
      // so the representative weight is 1 (no down-weighting occurred).
      const appliedQualityWeights = quality
        ? labels.map(
            (l) => quality.weightById[l.sourceId]?.weight ?? 1
          )
        : [];
      const qualityWeight =
        appliedQualityWeights.length > 0
          ? clamp01(
              appliedQualityWeights.reduce((sum, w) => sum + w, 0) /
                appliedQualityWeights.length
            )
          : 1;

      const signal = signalFromVerdict(aggregate.verdict);

      // Confidence = share of DIRECTIONAL evidence mass among all considered mass. It reflects
      // how much of the body of evidence actually makes a directional (SUPPORTS/REFUTES) claim,
      // NOT how lopsided that claim is.
      //
      // Why not Math.abs(netConfidence): that magnitude collapses to 0 when support and refute
      // masses are exactly balanced — precisely the strongest conflict case. Since the final
      // aggregator weights each vote by gate * confidence * categoryWeight, a 0 confidence would
      // zero out this agent's `mixed` vote and silently drop the conflict signal it just
      // detected, handing the decision back to Claude-alone. Using directional share keeps a
      // genuine two-sided conflict at HIGH confidence (it votes `mixed` firmly), while an
      // all-NEI / no-directional body honestly falls to 0.
      const { supportMass, refuteMass, neiMass } = aggregate.tally;
      const totalMass = supportMass + refuteMass + neiMass;
      const confidence =
        totalMass > 0
          ? clamp01((supportMass + refuteMass) / totalMass)
          : 0;

      // Provenance: which agent produced the labels we consumed (for the UI composition trace).
      const labelsProducer = bb.producerOf("source_labels");
      const qualityProducer = qualityWeighted
        ? bb.producerOf("quality")
        : undefined;
      const designProducer = designWeighted
        ? bb.producerOf("design_priors")
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
        // Numeric mean of the per-source quality weights this run applied (1 => no
        // down-weighting, e.g. when paper-qa's `quality` artifact was absent). Trace-only:
        // the aggregator reads its global quality multiplier solely from paper-qa's own
        // contribution (aggregate.ts QUALITY_PRODUCER_ID), so this scalar never double-counts
        // quality or moves the trust score — it only makes the applied weighting auditable.
        qualityWeight,
        // True when pytrials' design priors re-weighted at least one trial source's label.
        // Mean-preserving + clamped, so it sharpens the mix without moving the evidence mass.
        designWeighted,
        designSourceCount: designMultipliers.size,
        // Composition trace: this verifier built on these upstream producers.
        consumedFrom: {
          source_labels: labelsProducer ?? null,
          quality: qualityProducer ?? null,
          design_priors: designProducer ?? null,
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

// MoA expert adapter — MultiVerS (category: verification).
//
// WHAT IT CONTRIBUTES: confidence-weighted CROSS-SOURCE label aggregation. MultiVerS
// scores ONE {claim, abstract} pair at a time and emits a single SUPPORTS/REFUTES/NEI
// label per source; it does NOT combine those per-source labels into a claim-level
// verdict. lib/scieval/crossSourceAggregate.ts is that missing native step. This expert
// is the thin, stateless adapter over aggregateCrossSource().
//
// It creates NO labels — it only aggregates labels already assigned upstream and carried
// on each MoaSource as `label` (+ optional `labelConfidence`). Therefore it gates HIGH
// only when >=2 sources already carry a label, and gates 0 otherwise (honest MoE
// behavior: an aggregator with nothing to aggregate should never run).
//
// DETERMINISM: the whole run() path is a single call into the pure, LLM-free
// aggregateCrossSource() — no network, no DB pool, no Claude. usedClaude is always false.

import type { Expert, OrchestrationContext, ExpertContribution, MoaSource } from "../types";
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
import type { ExpertSignal } from "../types";

const EXPERT_ID = "multivers";

// Minimum labeled sources for this aggregator to be meaningful. One label is not an
// aggregation — it is just that one source's verdict. Two is the first point at which
// cross-source combination (agreement, conflict, dominance) can exist.
const MIN_LABELED_SOURCES = 2;

// Gate weight when the required input is present. High, per the engine spec: when >=2
// sources carry labels, cross-source aggregation is exactly what MultiVerS is for.
const GATE_ACTIVE = 0.85;

// A source proven (by narrowing) to carry an aggregatable label.
type LabeledSource = MoaSource & { label: NonNullable<MoaSource["label"]> };

// Collect the sources that carry an aggregatable label. Pure and cheap — safe for the
// router to call on every request.
function labeledSources(sources: readonly MoaSource[]): readonly LabeledSource[] {
  return sources.filter((s): s is LabeledSource => s.label !== undefined);
}

// Map a source's upstream label + optional label confidence onto the aggregator's input
// shape. labelConfidence is an already-normalized [0,1] signal upstream; aggregateCrossSource
// re-clamps and defaults it internally, so this mapping stays a pure rename.
function toCrossSourceInput(source: LabeledSource): CrossSourceInput {
  return source.labelConfidence !== undefined
    ? { id: source.id, label: source.label, confidence: source.labelConfidence }
    : { id: source.id, label: source.label };
}

// Map the deterministic 4-way aggregate verdict onto the uniform ExpertSignal.
function signalFromVerdict(verdict: CrossSourceVerdict): ExpertSignal {
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
  neiCount: number
): string {
  const tally = `${supportCount} support / ${refuteCount} refute / ${neiCount} no-info`;
  switch (verdict) {
    case "supported":
      return `Cross-source aggregate supports the claim (${tally}).`;
    case "refuted":
      return `Cross-source aggregate refutes the claim (${tally}).`;
    case "mixed":
      return `Labeled sources conflict with no dominant side (${tally}).`;
    case "insufficient":
      return `Labeled sources give no directional evidence (${tally}).`;
  }
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "MultiVerS Cross-Source Aggregator",
  category: "verification",
  description:
    "Confidence-weighted aggregation of upstream per-source SUPPORTS/REFUTES/NEI labels " +
    "into one deterministic claim-level verdict. Only runs when >=2 sources are labeled.",

  // Deterministic, pure: high only when there is something to aggregate (>=2 labeled
  // sources), 0 otherwise. This expert never creates labels, so with <2 labels it has
  // no honest work to do.
  gate(ctx: OrchestrationContext): number {
    const labeled = labeledSources(ctx.sources).length;
    return labeled >= MIN_LABELED_SOURCES ? GATE_ACTIVE : 0;
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    try {
      const labeled = labeledSources(ctx.sources);

      // Honest runtime skip — the router may have boosted the gate, but if the labels
      // are not actually here there is nothing to aggregate. Not an error.
      if (labeled.length < MIN_LABELED_SOURCES) {
        return skippedContribution(
          EXPERT_ID,
          "Needs at least two sources carrying a SUPPORTS/REFUTES/NEI label to aggregate; not enough labeled sources present."
        );
      }

      const inputs: CrossSourceInput[] = labeled.map(toCrossSourceInput);
      const aggregate = aggregateCrossSource(inputs);

      const signal = signalFromVerdict(aggregate.verdict);

      // Confidence is the magnitude of the deterministic net direction in [0,1]. A
      // "mixed"/"insufficient" verdict (netConfidence ~0 or no dominant side) yields low
      // confidence honestly; a lopsided verdict yields high confidence.
      const confidence = clamp01(Math.abs(aggregate.netConfidence));

      // Detail = the auditable tally + counts (ids/counts/scores only — no source text,
      // no secret data). groundedSpans stays empty: this expert consumes upstream labels
      // and produces no quotes of its own, so it must not fabricate any.
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
      };

      return makeContribution(EXPERT_ID, {
        ran: true,
        signal,
        confidence,
        summary: summarize(
          aggregate.verdict,
          aggregate.supportCount,
          aggregate.refuteCount,
          aggregate.neiCount
        ),
        detail,
        groundedSpans: [],
        usedClaude: false,
      });
    } catch (err) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;

// PaperTrail MoA v2 · MAGNITUDE RECONCILER — the flagship single-source distortion catch.
//
// This is the capability that separates PaperTrail from a fluent LLM: it does not ask a model
// whether a claimed effect size "looks right", it DETERMINISTICALLY recomputes the claim's
// asserted magnitude against the source's reported effect (HR/RR/OR + CI) and flags an
// overstatement or a dropped caveat by the numbers alone. It works on a SINGLE source (unlike
// PyMARE, which needs >=2 to pool), so it covers the common "reduced by 37%" vs. "HR 0.75 =
// 25%" distortion that a one-paper efficacy claim hides.
//
// COMPOSITION CONTRACT
//   produces: []                 — it votes, it does not publish an artifact.
//   consumes: ["effect_sizes"]   — quant-extractor's parsed effects tell it which sources
//                                  carry a reconcilable number; it only bothers reconciling
//                                  those (and reuses their verbatim `raw` substring for the
//                                  grounded span). The reconcile itself re-reads the source
//                                  text, so it degrades gracefully if the artifact is absent.
//
// MOAT: 100% deterministic — lib/effectSize.reconcile is regex extraction + fixed materiality
// arithmetic (OVERSTATE_FACTOR / CI exclusion). No LLM, no I/O, no DB. usedClaude is always
// false. Grounded spans are verbatim source substrings the extractor already matched.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  GroundedSpan,
  ParsedEffectSize,
  AgentSignal,
} from "../types";
import { makeContribution, skippedContribution, erroredContribution, clamp01 } from "../types";
import { reconcile, type ReconcileVerdict, type ParsedEffect } from "../../effectSize";
import { locateSpan } from "../../grounding";

const AGENT_ID = "magnitude";

// Reconcile verdicts that indicate a real distortion of the source by the claim.
const DISTORTIONS: ReadonlySet<ReconcileVerdict> = new Set([
  "magnitude_overstated",
  "caveat_dropped",
]);

// Ratio measures share a null of 1 and a common point + CI grammar. Kept local so the
// numeric cross-checks below stay entirely inside this deterministic agent.
const RATIO_MEASURES: ReadonlySet<ParsedEffect["measure"]> = new Set(["RR", "HR", "OR"]);

// Fix 1: below this |claimed - source| relative-reduction gap (in percentage points),
// a "magnitude_overstated" verdict that both describe the SAME reduction metric is a
// borderline rounding dispute, not a distortion. We reclassify it as borderline and do
// NOT let it drive a refutes vote. Chosen to match reconcile's own OVERSTATE_FACTOR intent.
const BORDERLINE_TOLERANCE_PCT = 5;

// Fix 5: when the effect_sizes artifact is absent, grounding is not pre-validated, so we
// degrade the confidence formula by this multiplier rather than voting at full strength.
const NO_ARTIFACT_CONFIDENCE_MULT = 0.9;

// Fix 3: a definite benefit assertion in the claim (mirrors effectSize's BENEFIT_RE, which
// is not exported). Deterministic regex — no LLM. Used only to decide whether an unambiguous
// significant source finding should be read as SUPPORTING the claim's asserted direction.
const BENEFIT_RE =
  /\b(reduc\w*|lower\w*|cut\w*|decreas\w*|improv\w*|effective|benefit\w*|prevent\w*|halv\w*|cuts?\b)/i;

interface SourceReconcile {
  sourceId: string;
  verdict: ReconcileVerdict;
  rationale: string;
  claimedValue: number | null;
  // Fix 1: true when a "distortion" verdict is actually within tight tolerance and should
  // be treated as insufficient rather than a refute.
  borderline?: boolean;
}

// Fix 4: an audit record of an effect whose verbatim span could not be located in the
// source text, so a silent grounding miss never looks like weak evidence.
interface UngroundedEffect {
  sourceId: string;
  attempted: string;
  reason: string;
}

// The relative reduction (percent) implied by a source's parsed ratio point estimate,
// e.g. HR 0.8 -> 20. Deterministic; mirrors effectSize's internal helper.
function sourceReductionPercent(effect: ParsedEffect): number | null {
  if (effect.point === null) return null;
  if (effect.measure === "RRR") return effect.point;
  if (RATIO_MEASURES.has(effect.measure)) return (1 - effect.point) * 100;
  return null;
}

// Fix 1: for a "magnitude_overstated" verdict, decide if the claimed and source reductions
// are within tight tolerance on the SAME (relative-reduction) metric. Pure arithmetic.
function isBorderlineOverstatement(rec: {
  verdict: ReconcileVerdict;
  claimedValue: number | null;
  sourceEffect: ParsedEffect | null;
}): boolean {
  if (rec.verdict !== "magnitude_overstated") return false;
  if (rec.claimedValue === null || rec.sourceEffect === null) return false;
  const src = sourceReductionPercent(rec.sourceEffect);
  if (src === null) return false;
  return Math.abs(rec.claimedValue - src) <= BORDERLINE_TOLERANCE_PCT;
}

// Fix 3: an unambiguous, significant source effect the claim's asserted direction can lean on
// even when the claim carries no reconcilable number. Deterministic significance test only.
function sourceHasSignificantEffect(effect: ParsedEffect | null): boolean {
  if (effect === null || effect.point === null) return false;
  if (RATIO_MEASURES.has(effect.measure)) {
    // Significant iff the CI is present AND does not cross the null of 1.
    if (effect.ciLow === null || effect.ciHigh === null) return false;
    return !(effect.ciLow <= 1 && effect.ciHigh >= 1);
  }
  if (effect.measure === "RRR") return effect.point > 0;
  if (effect.measure === "absolute") return effect.point > 0;
  return false;
}

// Logarithmic scaling so a single case does not vault confidence to the ceiling.
// 1 case -> +0.2, 3 -> +0.4, 7 -> +0.6. Fix 2.
function logScale(count: number): number {
  return 0.2 * Math.log2(count + 1);
}

// Find the effect the extractor already parsed for a source, so we can ground the
// reconcile against that verbatim `raw` substring rather than re-searching.
function effectFor(
  effects: readonly ParsedEffectSize[] | undefined,
  sourceId: string
): ParsedEffectSize | undefined {
  return effects?.find((e) => e.sourceId === sourceId);
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "Magnitude reconciler (effect-size)",
  category: "verification",
  description:
    "Deterministically recomputes the claim's asserted effect magnitude against each source's " +
    "reported HR/RR/OR + CI and flags overstatement or a dropped caveat — the single-source " +
    "distortion catch a fluent LLM misses. No LLM in the numeric path.",

  produces: [] as const,
  // Composes with quant-extractor: its effect_sizes mark which sources carry a reconcilable
  // number and provide the verbatim span to ground. Soft dep — reconcile re-reads the text.
  consumes: ["effect_sizes"] as const,

  // Pure/deterministic from input only: applicable whenever there is a claim and >=1 source.
  // reconcile returns "cannot_reconcile" when there is no number, so a low-signal fire is cheap
  // and honest rather than gated out.
  gate(ctx: OrchestrationContext): number {
    if (ctx.claim.trim().length === 0) return 0;
    const usable = ctx.sources.filter((s) => s.text.trim().length > 0).length;
    return usable === 0 ? 0 : 0.85;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    const claim = ctx.claim.trim();
    const usableSources = ctx.sources.filter((s) => s.text.trim().length > 0);
    if (claim.length === 0 || usableSources.length === 0) {
      return skippedContribution(AGENT_ID, "No claim or source text to reconcile the magnitude against.");
    }

    try {
      // COMPOSE: read quant-extractor's parsed effects (advisory — used to ground + summarize).
      const effects = bb.get("effect_sizes");

      const assertsBenefit = BENEFIT_RE.test(claim);

      const perSource: SourceReconcile[] = [];
      const groundedSpans: GroundedSpan[] = [];
      // Fix 4: audit trail of effects we tried but failed to ground verbatim.
      const ungroundedEffects: UngroundedEffect[] = [];
      // Fix 3: sources the claim can lean on despite carrying no reconcilable number.
      let unambiguousSupport = 0;
      let supportRationale = "";

      for (const source of usableSources) {
        const rec = reconcile(claim, source.text);
        const borderline = isBorderlineOverstatement(rec);
        perSource.push({
          sourceId: source.id,
          verdict: rec.verdict,
          rationale: rec.rationale,
          claimedValue: rec.claimedValue,
          ...(borderline ? { borderline: true } : {}),
        });

        // Fix 3: source has an unambiguous significant effect but the claim states no
        // reconcilable number (cannot_reconcile). If the claim asserts a benefit and the
        // source's finding is significant, that source SUPPORTS the claimed direction.
        if (
          rec.verdict === "cannot_reconcile" &&
          assertsBenefit &&
          sourceHasSignificantEffect(rec.sourceEffect)
        ) {
          unambiguousSupport += 1;
          if (supportRationale.length === 0 && rec.sourceEffect !== null) {
            supportRationale =
              `Source reports a significant ${rec.sourceEffect.measure} ${rec.sourceEffect.point} ` +
              `(CI ${rec.sourceEffect.ciLow ?? "n/a"} to ${rec.sourceEffect.ciHigh ?? "n/a"}); the ` +
              `claim asserts a benefit in the same direction though it states no comparable number.`;
          }
        }

        // Ground the source's effect number (verbatim) for the citation trail when we have one.
        const parsed = effectFor(effects, source.id);
        const rawNumber = parsed?.raw ?? rec.sourceEffect?.raw ?? null;
        if (rawNumber) {
          const located = locateSpan(source.text, rawNumber);
          if (located) {
            groundedSpans.push({
              sourceId: source.id,
              text: located.text,
              start: located.start,
              end: located.end,
            });
          } else {
            // Fix 4: reconciliation succeeded but the verbatim span was not locatable —
            // record it instead of silently dropping so the audit trail stays complete.
            ungroundedEffects.push({
              sourceId: source.id,
              attempted: rawNumber,
              reason: "verbatim effect substring not located in cached source text",
            });
          }
        }
      }

      // Fix 1: only NON-borderline distortions may drive a refute. Borderline overstatements
      // (claimed vs source reduction within tolerance) are treated as insufficient, not refuted.
      const distorted = perSource.filter((r) => DISTORTIONS.has(r.verdict) && r.borderline !== true);
      const consistent = perSource.filter((r) => r.verdict === "consistent");

      // Fix 5: without the effect_sizes artifact, grounding is not pre-validated — discount.
      const effectSizesConsumed = effects !== undefined;
      const artifactMult = effectSizesConsumed ? 1 : NO_ARTIFACT_CONFIDENCE_MULT;

      let signal: AgentSignal;
      let confidence: number;
      let summary: string;

      if (distorted.length > 0) {
        // The claim distorts at least one source's numbers — the flagship catch.
        signal = "refutes";
        // Fix 2 + Fix 6: distortions are rare catches that need corroboration, so start
        // cautious (0.55) and grow with the SHARE of sources distorted (ratio-based), never
        // exceeding 1.0 and never letting one distortion among many claim maximum confidence.
        const distortedShare = distorted.length / perSource.length;
        confidence = clamp01((0.55 + 0.45 * distortedShare) * artifactMult);
        const first = distorted[0];
        summary =
          `Magnitude distortion: ${first.verdict.replace("_", " ")} in ${distorted.length} ` +
          `source(s). ${first.rationale}`;
      } else if (consistent.length > 0) {
        // The claim's magnitude checks out against the source numbers.
        signal = "supports";
        // Fix 2: agreement is strong evidence — start at 0.75 and scale logarithmically so
        // more agreeing sources help without a single one being over-rewarded linearly.
        confidence = clamp01((0.75 + logScale(consistent.length) - 0.2) * artifactMult);
        summary = `Claimed magnitude is consistent with ${consistent.length} source effect(s). ${consistent[0].rationale}`;
      } else if (unambiguousSupport > 0) {
        // Fix 3: no reconcilable number in the claim, but at least one source has an
        // unambiguous, significant effect in the claim's asserted direction.
        signal = "supports";
        confidence = clamp01(0.6 * artifactMult);
        summary =
          `Source numeric finding supports the claim's direction in ${unambiguousSupport} source(s), ` +
          `though the claim states no comparable magnitude. ${supportRationale}`;
      } else {
        // No numbers to reconcile in either the claim or the sources — honest abstain.
        return makeContribution(AGENT_ID, {
          ran: true,
          signal: "insufficient",
          confidence: 0,
          summary: "No reconcilable effect size in the claim and sources; magnitude not assessable.",
          detail: {
            perSource,
            effectSizesConsumed,
            ...(ungroundedEffects.length > 0 ? { ungroundedEffects } : {}),
          },
          usedClaude: false,
        });
      }

      return makeContribution(AGENT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          perSource,
          distortedCount: distorted.length,
          consistentCount: consistent.length,
          unambiguousSupportCount: unambiguousSupport,
          effectSizesConsumed,
          ...(ungroundedEffects.length > 0 ? { ungroundedEffects } : {}),
        },
        groundedSpans,
        usedClaude: false,
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;

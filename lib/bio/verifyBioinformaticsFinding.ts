// UNIFIED BIOINFORMATICS FINDING VERIFIER — the sibling of verifyBiomedicalClaim.ts,
// for COMPUTATIONAL / OMICS findings (single-cell marker panels, variant→outcome
// direction, dose–response curves, effect sizes).
//
// PaperTrail's moat: DETERMINISTIC biology with NO LLM in the load-bearing numeric/
// decision path, and every quoted number GROUNDED to a verbatim substring of the source.
// This module answers, for a finding like "CD3D and CD8A mark cytotoxic T cells; the
// signature classifies responders with AUC 0.82 (95% CI 0.74–0.90)":
//
//   1. GROUND the effect-size number verbatim in sourceText via locateSpan
//      (lib/grounding.ts). A number that cannot be located is DROPPED and counted — we
//      never make an unsourced claim about the source.
//   2. Run the deterministic rule engines whose inputs are present:
//        - markerCanonicalization   (markerGenes + cellType, ontology-backed)
//        - variantOutcomeConsistency (reuses the ClinVar path, when a variant is given)
//        - doseResponseSanity        (dose–response points / potency+phase)
//        - effectSizeSanity          (AUC/HR/logFC coherence, pure)
//      and, where relevant, REUSE the existing composite engines validateBiomarker /
//      verifyPathogenicityClaim.
//   3. Combine into ONE verdict via a PURE, documented function (combineFindingVerdict),
//      reusing the SAME Signal vocabulary + precedence as verifyBiomedicalClaim.ts.
//
// Every external touchpoint is behind an INJECTABLE `deps` object so the whole verifier
// runs OFFLINE in tests against mocked engines. On any engine failure the check is
// dropped (honest omission) rather than fabricated.

import { locateSpan } from "@/lib/grounding";
import {
  BioinformaticsFindingVerificationSchema,
  type BioinformaticsFindingRequest,
  type BioinformaticsFindingVerification,
  type CanonicalizedMarker,
  type EffectSize,
  type FindingCheck,
  type FindingFlaggedSpan,
  type FindingSignal,
  type FindingVerdict,
} from "./bioinformatics.schemas";

import {
  verifyMarkerCanonicalization,
  type MarkerDeps,
  type MarkerCanonicalizationResult,
} from "./rules/markerCanonicalization";
import {
  verifyVariantOutcomeConsistency,
  type VariantOutcomeDeps,
} from "./rules/variantOutcomeConsistency";
import {
  verifyDoseResponseSanity,
  type DoseResponsePoint,
} from "./rules/doseResponseSanity";
import {
  verifyEffectSizeSanity,
  type ClaimedBenefit,
} from "./rules/effectSizeSanity";

import { validateBiomarker, type BiomarkerDeps } from "./biomarker";

// ---------------------------------------------------------------------------
// Injectable deps. Each field lets a test drop in a mock; production leaves it
// undefined and the real engine (bound to its own live default deps) is used.
// ---------------------------------------------------------------------------

export interface BioinformaticsDeps {
  // Marker-canonicalization engine deps (DB-backed; MUST be supplied in production by the
  // caller that has a Pool, or injected as a mock in tests — there is no live default
  // because it needs a database handle).
  markerDeps?: MarkerDeps;
  variantOutcomeDeps?: VariantOutcomeDeps;
  // Optional composite reuse: validate a biomarker↔disease relationship when the finding
  // names a biomarker gene + a population/disease. Off unless deps + a disease are present.
  biomarkerDeps?: BiomarkerDeps;
  // Mockable engine functions (default to the real ones).
  markerEngine?: typeof verifyMarkerCanonicalization;
  variantOutcomeEngine?: typeof verifyVariantOutcomeConsistency;
  biomarkerEngine?: typeof validateBiomarker;
}

// ---------------------------------------------------------------------------
// Optional structured inputs the caller may pass ALONGSIDE the base request. The base
// request (schema) is the public contract; these extend it for richer callers (dose
// points, variant identity, benefit direction) without changing the public API shape.
// ---------------------------------------------------------------------------

export interface BioinformaticsFindingInput extends BioinformaticsFindingRequest {
  // A variant identity to run the variant→outcome consistency check on.
  variant?: {
    rsId?: string;
    hgvs?: string;
    gene?: string;
    claimedDirection: "protective" | "risk";
  };
  // Dose–response points + optional potency/phase for the dose-response sanity check.
  doseResponse?: {
    points?: DoseResponsePoint[];
    claimedPotencyNM?: number | null;
    claimedPhase?: number | null;
  };
  // The claimed direction of benefit for an HR/logFC effect size (ignored for AUC).
  claimedBenefit?: ClaimedBenefit;
}

// ---------------------------------------------------------------------------
// Effect-size grounding. We format the reported number(s) as candidate strings and try
// to locate EACH verbatim in the source text. A number that can't be located is dropped
// + counted; the effect-size sanity check still runs on the provided numbers (the
// grounding governs whether we make a SPAN claim about the source, not whether the math
// is coherent).
// ---------------------------------------------------------------------------

// Format a number the way it commonly appears in text, generating a few tolerant variants
// (trailing-zero-trimmed, 2dp) so a value like 0.82 grounds against "0.82" or "0.820".
function numberCandidates(value: number): string[] {
  const cands = new Set<string>();
  cands.add(String(value));
  if (Number.isFinite(value)) {
    cands.add(value.toFixed(2));
    cands.add(value.toFixed(1));
    cands.add(value.toFixed(3));
    // Trim trailing zeros from the 3dp form (0.820 → 0.82).
    cands.add(value.toFixed(3).replace(/\.?0+$/, ""));
  }
  return [...cands].filter((c) => c.length > 0);
}

export interface EffectSizeGrounding {
  spans: FindingFlaggedSpan[];
  dropped: number;
}

/**
 * Ground the effect-size point estimate + CI bounds verbatim in the source text. For each
 * number we try its candidate string forms via locateSpan; the FIRST that locates yields a
 * grounded span, otherwise the number is dropped and counted. PURE over (effectSize,
 * sourceText). No LLM. The `issue` on each span is filled in later by the caller with the
 * sanity verdict; here we record a neutral provenance note.
 */
export function groundEffectSize(
  effect: EffectSize,
  sourceText: string
): EffectSizeGrounding {
  const spans: FindingFlaggedSpan[] = [];
  let dropped = 0;

  const targets: Array<{ label: string; value: number }> = [
    { label: `${effect.metric} point estimate`, value: effect.value },
  ];
  if (typeof effect.ci_lower === "number") {
    targets.push({ label: "CI lower bound", value: effect.ci_lower });
  }
  if (typeof effect.ci_upper === "number") {
    targets.push({ label: "CI upper bound", value: effect.ci_upper });
  }

  for (const target of targets) {
    let located: ReturnType<typeof locateSpan> = null;
    for (const cand of numberCandidates(target.value)) {
      located = locateSpan(sourceText, cand);
      if (located) break;
    }
    if (!located) {
      dropped += 1;
      continue;
    }
    spans.push({
      claim_span: `${target.label}: ${target.value}`,
      source_span: located.text,
      issue: `${target.label} grounded verbatim in the source text.`,
      grounding: {
        status: located.status,
        start: located.start,
        end: located.end,
      },
    });
  }

  return { spans, dropped };
}

// ---------------------------------------------------------------------------
// PURE roll-up. Identical precedence to verifyBiomedicalClaim.combineVerdicts, over the
// SAME Signal vocabulary — the two verifiers agree on how signals combine.
//
//   1. No check ran, or every check is `empty`   → insufficient_evidence
//   2. Any `overstated`                          → overstated (dominates)
//   3. >=1 positive and no negative              → supported
//   4. >=1 positive and >=1 negative             → partially_supported
//   5. otherwise (checks ran, none positive)     → unsupported
// ---------------------------------------------------------------------------

export function combineFindingVerdict(
  signals: readonly FindingSignal[]
): { verdict: FindingVerdict; rationale: string } {
  const ran = signals.length;
  const nonEmpty = signals.filter((s) => s !== "empty");

  if (ran === 0 || nonEmpty.length === 0) {
    return {
      verdict: "insufficient_evidence",
      rationale:
        ran === 0
          ? "No applicable deterministic check could run against this finding, so it can be neither supported nor refuted."
          : "Every applicable check returned an honest empty result, so the finding can be neither supported nor refuted from the available evidence.",
    };
  }

  const overstated = signals.filter((s) => s === "overstated").length;
  const positive = signals.filter((s) => s === "positive").length;
  const negative = signals.filter((s) => s === "negative").length;

  if (overstated > 0) {
    return {
      verdict: "overstated",
      rationale: `At least one deterministic check found the finding asserts more than the evidence supports (${overstated} overstated of ${nonEmpty.length} applicable check(s)).`,
    };
  }
  if (positive > 0 && negative === 0) {
    return {
      verdict: "supported",
      rationale: `Every applicable check that returned a result supports the finding (${positive} supporting, none contradicting).`,
    };
  }
  if (positive > 0 && negative > 0) {
    return {
      verdict: "partially_supported",
      rationale: `The evidence is mixed: ${positive} check(s) support the finding and ${negative} contradict or fall short.`,
    };
  }
  return {
    verdict: "unsupported",
    rationale: `Applicable checks ran but none confirmed the finding (${negative} contradicting or below-threshold).`,
  };
}

// ---------------------------------------------------------------------------
// The composer.
// ---------------------------------------------------------------------------

// Map an HR/logFC claimed direction to the effect-size benefit vocabulary when the caller
// didn't set one explicitly. HR<1/logFC<0 → reduction is a common "benefit". We only infer
// when the caller passed a variant claimedDirection ("protective" ≈ reduction of risk).
function inferClaimedBenefit(
  input: BioinformaticsFindingInput
): ClaimedBenefit | undefined {
  if (input.claimedBenefit) return input.claimedBenefit;
  if (input.variant?.claimedDirection === "protective") return "reduction";
  if (input.variant?.claimedDirection === "risk") return "increase";
  return undefined;
}

/**
 * Verify a bioinformatics finding by composing the deterministic rule engines + reused
 * composite engines, grounding every quoted number verbatim in the source, and rolling up
 * a PURE verdict. On any engine failure the check is dropped rather than fabricated.
 */
export async function verifyBioinformaticsFinding(
  input: BioinformaticsFindingInput,
  deps: BioinformaticsDeps = {}
): Promise<BioinformaticsFindingVerification> {
  const assertion = input.assertion.trim();
  const sourceText = input.sourceText;

  const markerEngine = deps.markerEngine ?? verifyMarkerCanonicalization;
  const variantOutcomeEngine =
    deps.variantOutcomeEngine ?? verifyVariantOutcomeConsistency;
  const biomarkerEngine = deps.biomarkerEngine ?? validateBiomarker;

  const checks: FindingCheck[] = [];
  const signals: FindingSignal[] = [];
  const flaggedSpans: FindingFlaggedSpan[] = [];
  let canonicalizedMarkers: CanonicalizedMarker[] = [];
  let droppedUngrounded = 0;

  // 1. Effect-size grounding + sanity (only when an effect size + source text are given).
  if (input.effectSize) {
    const grounding = groundEffectSize(input.effectSize, sourceText);
    droppedUngrounded += grounding.dropped;

    const sanity = verifyEffectSizeSanity({
      metric: input.effectSize.metric,
      value: input.effectSize.value,
      ciLower: input.effectSize.ci_lower ?? null,
      ciUpper: input.effectSize.ci_upper ?? null,
      claimedBenefit: inferClaimedBenefit(input),
    });

    // Attach the sanity issue to the point-estimate span (if grounded) so a flagged span
    // carries WHY it's flagged, not just that it was located.
    const groundedSpans = grounding.spans.map((span, i) =>
      i === 0 && sanity.issues.length > 0
        ? { ...span, issue: sanity.issues[0].message }
        : span
    );
    flaggedSpans.push(...groundedSpans);

    checks.push({
      kind: "effect_size_sanity",
      signal: sanity.signal,
      summary:
        sanity.summary +
        (grounding.dropped > 0
          ? ` ${grounding.dropped} reported number(s) could not be grounded verbatim in the source and were dropped.`
          : ""),
    });
    signals.push(sanity.signal);
  }

  // 2. Marker canonicalization (markerGenes + cellType). Requires DB-backed markerDeps;
  //    without them we honestly skip (no live default for a DB handle).
  const cellType = input.cellType?.trim() || null;
  if (deps.markerDeps && input.markerGenes.length > 0 && cellType) {
    const res: MarkerCanonicalizationResult | null = await markerEngine(
      { markerGenes: input.markerGenes, cellType },
      deps.markerDeps
    ).catch<null>(() => null);

    if (res) {
      canonicalizedMarkers = res.canonicalizedMarkers;
      // Only surface a check when something was actually assessable.
      if (res.signal !== "empty" || res.cellTypeMatched) {
        checks.push({
          kind: "marker_canonicalization",
          signal: res.signal,
          summary: res.summary,
        });
        signals.push(res.signal);
      }
    }
  }

  // 3. Variant→outcome consistency (reuses the ClinVar path) when a variant is given.
  if (input.variant && (input.variant.rsId || input.variant.hgvs || input.variant.gene)) {
    const res = await variantOutcomeEngine(
      {
        rsId: input.variant.rsId,
        hgvs: input.variant.hgvs,
        gene: input.variant.gene,
        condition: input.population ?? undefined,
        claimedDirection: input.variant.claimedDirection,
      },
      deps.variantOutcomeDeps
    ).catch(() => null);

    if (res && res.signal !== "empty") {
      checks.push({
        kind: "variant_outcome_consistency",
        signal: res.signal,
        summary: res.summary,
      });
      signals.push(res.signal);
    }
  }

  // 4. Dose–response sanity (when dose points or a potency/phase claim are present).
  if (
    input.doseResponse &&
    ((input.doseResponse.points && input.doseResponse.points.length > 0) ||
      typeof input.doseResponse.claimedPotencyNM === "number" ||
      typeof input.doseResponse.claimedPhase === "number")
  ) {
    const res = verifyDoseResponseSanity({
      points: input.doseResponse.points,
      claimedPotencyNM: input.doseResponse.claimedPotencyNM,
      claimedPhase: input.doseResponse.claimedPhase,
    });
    if (res.signal !== "empty") {
      checks.push({
        kind: "dose_response_sanity",
        signal: res.signal,
        summary: res.summary,
      });
      signals.push(res.signal);
    }
  }

  // 5. OPTIONAL composite reuse: validate the first marker gene as a biomarker of the
  //    population/disease when biomarkerDeps + a population string are present.
  const disease = input.population?.trim() || null;
  const firstMarker = input.markerGenes.map((g) => g.trim()).find((g) => g.length > 0);
  if (deps.biomarkerDeps && disease && firstMarker) {
    const res = await biomarkerEngine(
      { biomarker: firstMarker, disease },
      deps.biomarkerDeps
    ).catch(() => null);

    if (res) {
      const signal = biomarkerLevelSignal(res.validationLevel);
      if (signal !== "empty") {
        checks.push({
          kind: "biomarker_validation",
          signal,
          summary: res.rationale,
        });
        signals.push(signal);
      }
    }
  }

  const { verdict, rationale } = combineFindingVerdict(signals);

  const result: BioinformaticsFindingVerification = {
    assertion,
    verdict,
    rationale,
    signals: checks,
    flagged_spans: flaggedSpans,
    canonicalizedMarkers,
    droppedUngrounded,
  };

  // Defensive: validate the composed shape before it escapes this module.
  return BioinformaticsFindingVerificationSchema.parse(result);
}

// Map the deterministic biomarker validationLevel onto a finding signal. A grounded/
// emerging biomarker corroborates the finding (positive); weak is a soft negative;
// unsupported is an honest empty (no evidence either way).
function biomarkerLevelSignal(level: string): FindingSignal {
  switch (level) {
    case "analytically_grounded":
    case "emerging":
      return "positive";
    case "weak":
      return "negative";
    default:
      return "empty";
  }
}

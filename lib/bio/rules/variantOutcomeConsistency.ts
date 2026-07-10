// VARIANT–OUTCOME CONSISTENCY rule engine.
//
// A bioinformatics finding often asserts a DIRECTION for a variant's effect on an
// outcome: "variant X is protective against DISEASE" or "variant X increases risk of
// DISEASE". This engine checks that claimed direction against ClinVar's REGISTERED
// clinical significance for the variant, and flags a contradiction.
//
// MOAT: we REUSE the existing deterministic ClinVar path (lib/bio/variantPathogenicity.ts)
// verbatim — no LLM, no new data path. The registered significance (Pathogenic / Likely
// pathogenic / Benign / Likely benign / VUS / Conflicting) is a pure function of the
// E-utilities response. We then compare it to the claimed direction:
//
//   - claim "risk" (deleterious)      is consistent with Pathogenic / Likely pathogenic
//   - claim "protective" (benign)     is consistent with Benign / Likely benign
//   - a claim that asserts the OPPOSITE polarity of a CONFIDENT ClinVar record
//     (>= CONFIDENT_STAR_THRESHOLD stars) is a CONTRADICTION → overstated/negative.
//
// Nothing is fabricated: no ClinVar record, a VUS, or a conflicting record yields an
// honest empty/negative rather than a forced direction.

import {
  verifyPathogenicityClaim,
  type VariantDeps,
} from "@/lib/bio/variantPathogenicity";
import type {
  ClinicalSignificance,
  PathogenicityVerification,
} from "@/lib/bio/variant.schemas";
import type {
  ClaimedDirection,
  FindingSignal,
} from "@/lib/bio/bioinformatics.schemas";

// The polarity a ClinVar tier implies for an outcome direction, or null when the tier
// carries no directional claim (VUS / Conflicting / unclassified). "risk" = deleterious,
// "protective" = benign. This is a fixed, documented mapping — not tuned.
function tierPolarity(tier: ClinicalSignificance | null): ClaimedDirection | null {
  switch (tier) {
    case "Pathogenic":
    case "Likely pathogenic":
      return "risk";
    case "Benign":
    case "Likely benign":
      return "protective";
    default:
      // VUS, Conflicting, or unmapped → no directional claim.
      return null;
  }
}

export interface VariantOutcomeConsistencyResult {
  claimedDirection: ClaimedDirection;
  // The direction ClinVar's strongest record implies, or null when it carries none.
  registeredDirection: ClaimedDirection | null;
  // The underlying deterministic ClinVar verification (audit trail).
  pathogenicity: PathogenicityVerification;
  signal: FindingSignal;
  summary: string;
}

// The dependencies this engine needs: the ClinVar verifier (defaults to the real one) and
// its passthrough deps. Injectable so tests run offline against a mocked verifier.
export interface VariantOutcomeDeps {
  verifyPathogenicity?: typeof verifyPathogenicityClaim;
  variantDeps?: VariantDeps;
}

/**
 * Classify the consistency of a claimed direction against a ClinVar verification. PURE —
 * no network, no LLM. Precedence:
 *   - not_found                         → empty  (no record to check against)
 *   - Conflicting classifications       → negative (ClinVar itself disagrees; can't back a
 *                                          confident direction)
 *   - confident record, SAME polarity   → positive (ClinVar backs the claimed direction)
 *   - confident record, OPPOSITE polarity → overstated (claim contradicts ClinVar)
 *   - no directional polarity (VUS) or below confidence → negative (a directional claim on
 *                                          a variant ClinVar doesn't directionally support)
 */
export function classifyVariantOutcome(
  claimedDirection: ClaimedDirection,
  verification: PathogenicityVerification
): { registeredDirection: ClaimedDirection | null; signal: FindingSignal; summary: string } {
  const best = verification.bestRecord;

  if (verification.verdict === "not_found" || best === null) {
    return {
      registeredDirection: null,
      signal: "empty",
      summary:
        "ClinVar has no record for this variant, so the claimed direction could not be checked.",
    };
  }

  if (verification.verdict === "conflicting" || best.clinicalSignificance === "Conflicting") {
    return {
      registeredDirection: null,
      signal: "negative",
      summary: `ClinVar reports conflicting classifications for this variant (${best.starRating}★), so a confident ${claimedDirection} direction is not supported.`,
    };
  }

  const registeredDirection = tierPolarity(best.clinicalSignificance);
  // ClinVar carries no directional polarity for this record (e.g. VUS) — a directional
  // claim outruns what the record supports.
  if (registeredDirection === null) {
    return {
      registeredDirection: null,
      signal: "negative",
      summary: `ClinVar classifies this variant as ${best.clinicalSignificance ?? "unclassified"} (${best.starRating}★), which carries no ${claimedDirection}/protective direction to support the claim.`,
    };
  }

  // Confidence gate: a directional claim resting on a 0-star ClinVar record overstates.
  const confident = best.starRating >= 1;
  if (!confident) {
    return {
      registeredDirection,
      signal: "overstated",
      summary: `The claimed ${claimedDirection} direction rests on a ClinVar ${best.clinicalSignificance} record at only ${best.starRating}★ (no assertion criteria) — the claim overstates the certainty ClinVar supports.`,
    };
  }

  if (registeredDirection === claimedDirection) {
    return {
      registeredDirection,
      signal: "positive",
      summary: `ClinVar classifies this variant as ${best.clinicalSignificance} (${best.starRating}★), consistent with the claimed ${claimedDirection} direction.`,
    };
  }

  return {
    registeredDirection,
    signal: "overstated",
    summary: `The claim asserts a ${claimedDirection} direction, but ClinVar classifies this variant as ${best.clinicalSignificance} (${best.starRating}★), implying the OPPOSITE (${registeredDirection}) direction — the claim contradicts the registered significance.`,
  };
}

/**
 * Verify a claimed variant→outcome direction against ClinVar. Reuses verifyPathogenicityClaim
 * (deterministic) and compares its registered significance to the claimed direction. On any
 * failure the engine degrades to an honest empty result. Offline-testable via injected deps.
 */
export async function verifyVariantOutcomeConsistency(
  input: {
    rsId?: string;
    hgvs?: string;
    gene?: string;
    condition?: string;
    claimedDirection: ClaimedDirection;
  },
  deps: VariantOutcomeDeps = {}
): Promise<VariantOutcomeConsistencyResult> {
  const verify = deps.verifyPathogenicity ?? verifyPathogenicityClaim;

  // Feed ClinVar a claimedSignificance derived from the direction so the underlying engine
  // reasons about the SAME polarity we're testing (pathogenic ↔ risk, benign ↔ protective).
  const claimedSignificance =
    input.claimedDirection === "risk" ? "Pathogenic" : "Benign";

  const verification = await verify(
    {
      rsId: input.rsId,
      hgvs: input.hgvs,
      gene: input.gene,
      condition: input.condition,
      claimedSignificance,
    },
    deps.variantDeps
  ).catch<null>(() => null);

  if (verification === null) {
    // Build an honest empty verification shell so the caller always has a typed result.
    return {
      claimedDirection: input.claimedDirection,
      registeredDirection: null,
      pathogenicity: {
        verdict: "not_found",
        query: {
          rsId: input.rsId ?? null,
          hgvs: input.hgvs ?? null,
          gene: input.gene ?? null,
          condition: input.condition ?? null,
          claimedSignificance,
        },
        records: [],
        bestRecord: null,
        rationale: "ClinVar lookup failed; no record available to check the claimed direction.",
      },
      signal: "empty",
      summary:
        "ClinVar lookup failed, so the claimed variant direction could not be checked (honest miss).",
    };
  }

  const { registeredDirection, signal, summary } = classifyVariantOutcome(
    input.claimedDirection,
    verification
  );

  return {
    claimedDirection: input.claimedDirection,
    registeredDirection,
    pathogenicity: verification,
    signal,
    summary,
  };
}

import { z } from "zod";

// Zod schemas for the BIOINFORMATICS FINDING VERIFIER — the sibling of the
// biomedical-claim verifier, but for computational/omics findings (single-cell
// marker panels, variant→outcome direction, dose-response curves, effect sizes).
//
// MOAT: every verdict and every number is DETERMINISTIC. Claude is NEVER in the
// numeric/decision path. Entity linking is done by the deterministic ontology
// canonicalizer (lib/entities/canonicalize.ts), not an LLM. Every quoted number is
// grounded to a VERBATIM substring of the provided source text via locateSpan
// (lib/grounding.ts); anything that cannot be located is dropped and counted.
//
// These schemas (1) validate the SHAPE of the public request at the boundary and
// (2) validate the composed result before it escapes the module, so a malformed
// signal can never smuggle a nonsense value into the deterministic verdict.

// --- Shared signal vocabulary (REUSED from verifyBiomedicalClaim.ts) -------------
//
// The four coarse buckets the roll-up reasons over. Kept identical to the biomedical
// verifier so the two composers share one auditable vocabulary + precedence:
//   positive   — the evidence supports the claim.
//   overstated — the claim asserts MORE than the data supports (dangerous direction).
//   negative   — evidence exists but contradicts / falls short of supporting the claim.
//   empty      — an honest not-found / no-evidence-either-way.
export const FINDING_SIGNALS = [
  "positive",
  "overstated",
  "negative",
  "empty",
] as const;
export const FindingSignalSchema = z.enum(FINDING_SIGNALS);
export type FindingSignal = (typeof FINDING_SIGNALS)[number];

// --- Effect-size input ----------------------------------------------------------

// The three effect-size metrics the finding verifier reasons over:
//   AUC   — area under the ROC curve; a classifier/biomarker discrimination metric in
//           [0.5, 1] (0.5 = no better than chance). Larger = better.
//   HR    — hazard ratio; HR<1 = protective (fewer events), HR>1 = harmful. 1 = null.
//   logFC — log fold-change of expression; sign is the direction of regulation.
export const EFFECT_METRICS = ["AUC", "HR", "logFC"] as const;
export const EffectMetricSchema = z.enum(EFFECT_METRICS);
export type EffectMetric = (typeof EFFECT_METRICS)[number];

export const EffectSizeSchema = z.object({
  metric: EffectMetricSchema,
  value: z.number().finite(),
  // Optional confidence interval. When present, both bounds must be finite.
  ci_lower: z.number().finite().optional(),
  ci_upper: z.number().finite().optional(),
});
export type EffectSize = z.infer<typeof EffectSizeSchema>;

// --- Public request -------------------------------------------------------------

// A bioinformatics finding is an ASSERTION (free text describing the finding), the
// claimed marker genes + cell type it rests on, an effect size, the study population,
// and the SOURCE TEXT the numbers must be grounded in. The source text is the verbatim
// abstract/results passage; every quoted number must appear in it.
export const BioinformaticsFindingRequestSchema = z.object({
  assertion: z.string().trim().min(1, "assertion is required").max(2000),
  markerGenes: z
    .array(z.string().trim().min(1).max(50))
    .max(200)
    .default([]),
  cellType: z.string().trim().min(1).max(200).nullable().optional(),
  effectSize: EffectSizeSchema.nullable().optional(),
  population: z.string().trim().min(1).max(500).nullable().optional(),
  sourceText: z.string().min(1, "sourceText is required").max(200_000),
});
export type BioinformaticsFindingRequest = z.infer<
  typeof BioinformaticsFindingRequestSchema
>;

// --- Grounded span (mirrors lib/grounding.ts GroundedSpan shape) -----------------

export const FindingGroundingStatusSchema = z.enum(["exact", "approximate"]);

export const FindingFlaggedSpanSchema = z.object({
  // What the claim asserted (the number/phrase we tried to ground).
  claim_span: z.string(),
  // The VERBATIM substring of sourceText we actually located (never a paraphrase).
  source_span: z.string(),
  // Why this span is flagged (what the deterministic check found).
  issue: z.string(),
  grounding: z.object({
    status: FindingGroundingStatusSchema,
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
});
export type FindingFlaggedSpan = z.infer<typeof FindingFlaggedSpanSchema>;

// --- Canonicalized marker (verbatim from the ontology canonicalizer) -------------

// The result of resolving one claimed marker-gene surface form against the ontology.
// `curie`/`canonicalLabel` are null when the surface form did not resolve (honest miss).
export const CanonicalizedMarkerSchema = z.object({
  surface: z.string(),
  curie: z.string().nullable(),
  canonicalLabel: z.string().nullable(),
  // Whether this canonical gene is a registered marker for the claimed cell type.
  isMarker: z.boolean(),
  // The registered marker direction ('positive' | 'negative') when known, else null.
  markerDirection: z.string().nullable(),
});
export type CanonicalizedMarker = z.infer<typeof CanonicalizedMarkerSchema>;

// --- Per-check result -----------------------------------------------------------

// One rule engine's contribution: which engine, its coarse signal, and a verbatim,
// deterministic summary of what it found. `detail` carries the engine's own typed
// result for the audit trail (kept as unknown here; each engine's module owns its type).
export const FINDING_CHECK_KINDS = [
  "marker_canonicalization",
  "variant_outcome_consistency",
  "dose_response_sanity",
  "effect_size_sanity",
  "biomarker_validation",
  "variant_pathogenicity",
] as const;
export const FindingCheckKindSchema = z.enum(FINDING_CHECK_KINDS);
export type FindingCheckKind = (typeof FINDING_CHECK_KINDS)[number];

export const FindingCheckSchema = z.object({
  kind: FindingCheckKindSchema,
  signal: FindingSignalSchema,
  summary: z.string(),
});
export type FindingCheck = z.infer<typeof FindingCheckSchema>;

// --- Overall verdict ------------------------------------------------------------

// Identical vocabulary + precedence to the biomedical verifier's OverallVerdict, so the
// two composers roll up the same way (see combineFindingVerdict).
export const FINDING_VERDICTS = [
  "supported",
  "overstated",
  "partially_supported",
  "unsupported",
  "insufficient_evidence",
] as const;
export const FindingVerdictSchema = z.enum(FINDING_VERDICTS);
export type FindingVerdict = (typeof FINDING_VERDICTS)[number];

export const BioinformaticsFindingVerificationSchema = z.object({
  assertion: z.string(),
  verdict: FindingVerdictSchema,
  rationale: z.string().min(1),
  signals: z.array(FindingCheckSchema),
  flagged_spans: z.array(FindingFlaggedSpanSchema),
  canonicalizedMarkers: z.array(CanonicalizedMarkerSchema),
  // How many claimed numbers could NOT be grounded verbatim in sourceText and were
  // dropped (the honest cost of the grounding invariant).
  droppedUngrounded: z.number().int().nonnegative(),
});
export type BioinformaticsFindingVerification = z.infer<
  typeof BioinformaticsFindingVerificationSchema
>;

// --- marker-check route request -------------------------------------------------

export const MarkerCheckRequestSchema = z.object({
  markerGenes: z
    .array(z.string().trim().min(1).max(50))
    .min(1, "provide at least one marker gene")
    .max(200),
  cellType: z.string().trim().min(1, "cellType is required").max(200),
});
export type MarkerCheckRequest = z.infer<typeof MarkerCheckRequestSchema>;

// --- variant-outcome route request ----------------------------------------------

// The claimed clinical direction of a variant's effect on an outcome:
//   protective — the variant REDUCES risk / is protective.
//   risk       — the variant INCREASES risk / is deleterious.
export const CLAIMED_DIRECTIONS = ["protective", "risk"] as const;
export const ClaimedDirectionSchema = z.enum(CLAIMED_DIRECTIONS);
export type ClaimedDirection = (typeof CLAIMED_DIRECTIONS)[number];

export const VariantOutcomeRequestSchema = z.object({
  rsId: z.string().trim().min(1).max(50).optional(),
  hgvs: z.string().trim().min(1).max(200).optional(),
  gene: z.string().trim().min(1).max(50).optional(),
  condition: z.string().trim().min(1).max(200).optional(),
  claimedDirection: ClaimedDirectionSchema,
});
export type VariantOutcomeRequest = z.infer<typeof VariantOutcomeRequestSchema>;

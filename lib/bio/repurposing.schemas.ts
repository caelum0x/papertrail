import { z } from "zod";

// Zod schemas for the DRUG-REPURPOSING EVIDENCE BUNDLE layer.
//
// This module assembles an evidence bundle for a proposed drug<->indication link
// out of the bio engines already built (Open Targets, ChEMBL max-phase/bioactivity,
// ClinicalTrials.gov, FDA FAERS). The composite `score` and `verdict` are computed
// DETERMINISTICALLY from the component signals with a documented, fixed weighting —
// NO LLM is ever in the numeric path (PaperTrail moat). The OPTIONAL Claude summary
// is a separate, additive prose layer that can only describe the already-assembled
// evidence and is validated against RepurposingSummarySchema before use.
//
// Roles:
//   1. Validate the SHAPE of each assembled component so a malformed signal can't
//      smuggle a nonsense value into the composite.
//   2. Validate the OPTIONAL Claude plain-language summary (CLAUDE.md: never trust a
//      raw JSON.parse of an LLM response).
//
// Data-source attribution (respect licenses):
//   - Open Targets Platform (CC0) — target-disease genetic association.
//   - ChEMBL (CC BY-SA 3.0) — drug max clinical phase + target bioactivity.
//     Attribution + share-alike required; do NOT relicense derived values restrictively.
//   - ClinicalTrials.gov (public domain, U.S. Gov) — existing trials incl. failures.
//   - FDA FAERS / openFDA (public domain) — pharmacovigilance disproportionality.
// We deliberately do NOT use DrugBank or DisGeNET (license-incompatible).

// ---------------------------------------------------------------------------
// Component: shared targets (Open Targets genetic association)
// ---------------------------------------------------------------------------

// Does the drug's molecular target genetically associate with the indication?
// `geneticScore` is the Open Targets genetic_association datatype score in [0,1],
// verbatim; null when Open Targets has no genetic evidence for the pair (never a
// fabricated 0). `overallScore` is the overall association for context.
export const SharedTargetsSchema = z.object({
  // The target symbol the drug acts on, if a mechanism/target could be identified.
  targetSymbol: z.string().nullable(),
  // Whether Open Targets returned a scored association for target<->indication.
  associationFound: z.boolean(),
  overallScore: z.number().min(0).max(1).nullable(),
  geneticScore: z.number().min(0).max(1).nullable(),
});
export type SharedTargets = z.infer<typeof SharedTargetsSchema>;

// ---------------------------------------------------------------------------
// Component: mechanism (ChEMBL max_phase + target bioactivity)
// ---------------------------------------------------------------------------

// ChEMBL max clinical phase the molecule has reached (0..4; null if unknown), its
// mechanism-of-action string, and whether measured target bioactivity exists. All
// values are VERBATIM from ChEMBL — we never infer a phase the source didn't report.
export const MechanismSchema = z.object({
  chemblId: z.string().nullable(),
  // ChEMBL max_phase: 0 (preclinical) .. 4 (approved). null when not reported.
  maxPhase: z.number().min(0).max(4).nullable(),
  mechanismOfAction: z.string().nullable(),
  // True when ChEMBL reports at least one measured bioactivity against the target.
  hasTargetBioactivity: z.boolean(),
});
export type Mechanism = z.infer<typeof MechanismSchema>;

// ---------------------------------------------------------------------------
// Component: existing trials (ClinicalTrials.gov)
// ---------------------------------------------------------------------------

// One trial of this drug for this indication. `failed` is set ONLY when the registry
// reports an unambiguous negative outcome (terminated/withdrawn/suspended), never
// inferred from absence of results — an ongoing or completed trial is NOT "failed".
export const RepurposingTrialSchema = z.object({
  nctId: z.string(),
  title: z.string(),
  phase: z.string().nullable(),
  overallStatus: z.string().nullable(),
  failed: z.boolean(),
});
export type RepurposingTrial = z.infer<typeof RepurposingTrialSchema>;

export const ExistingTrialsSchema = z.object({
  trials: z.array(RepurposingTrialSchema),
  count: z.number().int().nonnegative(),
  // True when ANY returned trial is unambiguously failed (terminated/withdrawn).
  hasFailedTrial: z.boolean(),
});
export type ExistingTrials = z.infer<typeof ExistingTrialsSchema>;

// ---------------------------------------------------------------------------
// Component: safety (FAERS disproportionality summary for the drug)
// ---------------------------------------------------------------------------

// A compact pharmacovigilance summary for the drug against the indication's own
// adverse-event term (worsening-of-condition style signal). Verbatim from the FAERS
// disproportionality engine; null fields when no signal could be assembled.
export const SafetySummarySchema = z.object({
  assessed: z.boolean(),
  prr: z.number().nullable(),
  ic025: z.number().nullable(),
  // The deterministic FAERS signal flag (Evans/MHRA rule). True = disproportionate
  // reporting — a caution flag for repurposing, not proof of harm.
  signal: z.boolean(),
});
export type SafetySummary = z.infer<typeof SafetySummarySchema>;

// ---------------------------------------------------------------------------
// Verdict + composite bundle
// ---------------------------------------------------------------------------

export const REPURPOSING_VERDICTS = [
  "strong_rationale",
  "plausible",
  "weak",
  "discouraged",
] as const;
export const RepurposingVerdictSchema = z.enum(REPURPOSING_VERDICTS);
export type RepurposingVerdict = z.infer<typeof RepurposingVerdictSchema>;

export const RepurposingEvidenceSchema = z.object({
  drug: z.string(),
  indication: z.string(),
  sharedTargets: SharedTargetsSchema,
  mechanism: MechanismSchema,
  existingTrials: ExistingTrialsSchema,
  safety: SafetySummarySchema,
  // Deterministic composite in [0,1] from the documented component weighting.
  score: z.number().min(0).max(1),
  verdict: RepurposingVerdictSchema,
  // Human-readable, deterministic explanation of what drove score + verdict.
  rationale: z.string().min(1),
});
export type RepurposingEvidence = z.infer<typeof RepurposingEvidenceSchema>;

// The OPTIONAL Claude-generated prose summary. Validated before use. It describes
// ONLY the assembled evidence; it carries no numbers of its own — the score/verdict
// the caller shows always come from the deterministic RepurposingEvidence above.
export const RepurposingSummarySchema = z.object({
  summary: z.string().min(1),
  // The single component the model judged most decisive, echoed back for the UI.
  // Constrained so the model can't invent a driver outside the assembled evidence.
  keyDriver: z
    .enum(["shared_target", "mechanism", "existing_trials", "safety"])
    .nullable(),
});
export type RepurposingSummary = z.infer<typeof RepurposingSummarySchema>;

// The public POST body for /api/bio/repurposing.
export const RepurposingRequestSchema = z.object({
  drug: z.string().trim().min(1, "drug is required").max(200),
  indication: z.string().trim().min(1, "indication is required").max(200),
});
export type RepurposingRequest = z.infer<typeof RepurposingRequestSchema>;

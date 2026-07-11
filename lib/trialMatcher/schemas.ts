// Zod schemas for the CLINICAL TRIAL MATCHER (lib/trialMatcher/*).
//
// The trust contract lives here. A research coordinator pastes free-text,
// de-identified patient notes; Claude extracts a structured patient profile, we
// query ClinicalTrials.gov for candidate trials, parse each trial's eligibility into
// inclusion/exclusion criteria, and assess EACH criterion against the profile
// (met / not_met / unknown) with reasoning grounded to the exact criterion text.
//
// TWO non-negotiable governance invariants, enforced downstream and mirrored here:
//
//  1. NO IDENTIFIERS. The profile NEVER carries a patient name, MRN, date of birth,
//     address, phone, or any direct identifier. Only clinically relevant, de-identified
//     facts are extracted. This is stated in the extraction prompt AND is why the schema
//     has no name/mrn/dob field to put one in.
//
//  2. GROUNDING. Every field that quotes the source (a note span, an eligibility
//     criterion) carries a `source_span` that is a VERBATIM substring of the raw text.
//     After the Claude call, locateSpan() is run on every such span; ungroundable spans
//     are dropped (or nulled) and COUNTED in `droppedUngrounded`. PaperTrail never makes
//     an unsourced claim about a source.
//
// All Claude output is validated against these schemas (via callClaudeForJson) before
// use — never trust raw JSON.parse of a model response.

import { z } from "zod";

// ---------------------------------------------------------------------------
// PATIENT PROFILE — the de-identified structured facts Claude extracts from the notes.
// Every quoted field carries a `source_span` grounded verbatim against the notes.
// There is deliberately NO field for a name, MRN, or DOB: identifiers are never
// extracted, so there is nowhere in the shape to store one.
// ---------------------------------------------------------------------------

// A quoted note span. `source_span` is the verbatim substring of the notes that
// supports this fact (grounded via locateSpan after extraction).
const GroundedFactSchema = z.object({
  name: z.string().trim().min(1).max(300),
  source_span: z.string().min(1).max(600),
});
export type GroundedFact = z.infer<typeof GroundedFactSchema>;

// A biomarker with an optional status (e.g. "positive", "negative", "mutated").
const BiomarkerSchema = z.object({
  name: z.string().trim().min(1).max(300),
  status: z.string().trim().max(200).nullable().default(null),
  source_span: z.string().min(1).max(600),
});
export type Biomarker = z.infer<typeof BiomarkerSchema>;

// A lab value (e.g. "eGFR" = "45 mL/min/1.73m2").
const LabSchema = z.object({
  name: z.string().trim().min(1).max(300),
  value: z.string().trim().min(1).max(200),
  source_span: z.string().min(1).max(600),
});
export type Lab = z.infer<typeof LabSchema>;

// A free-text de-identified factor that doesn't fit the structured buckets.
const OtherFactorSchema = z.object({
  text: z.string().trim().min(1).max(400),
  source_span: z.string().min(1).max(600),
});
export type OtherFactor = z.infer<typeof OtherFactorSchema>;

export const PatientProfileSchema = z.object({
  age: z.number().int().min(0).max(130).nullable().default(null),
  sex: z.string().trim().max(60).nullable().default(null),
  conditions: z.array(GroundedFactSchema).max(40).default([]),
  biomarkers: z.array(BiomarkerSchema).max(40).default([]),
  prior_treatments: z.array(GroundedFactSchema).max(40).default([]),
  performance_status: z.string().trim().max(200).nullable().default(null),
  labs: z.array(LabSchema).max(40).default([]),
  other_factors: z.array(OtherFactorSchema).max(40).default([]),
  // Search terms for a trial query — main condition plus key biomarkers. Not quoted,
  // so not grounded; these steer retrieval only, they make no claim about the source.
  search_terms: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
});
export type PatientProfile = z.infer<typeof PatientProfileSchema>;

// ---------------------------------------------------------------------------
// CRITERION ASSESSMENT — Claude's per-criterion verdict against the profile.
// `source_span` is the verbatim eligibility-criterion text (grounded via locateSpan
// against the trial's raw criteria; nulled if ungroundable). SEMANTICS: for an
// EXCLUSION criterion, assessment="met" means the patient MEETS the exclusion =>
// this makes them INELIGIBLE. For an INCLUSION criterion, "met" is favourable.
// ---------------------------------------------------------------------------
export const CriterionTypeSchema = z.enum(["inclusion", "exclusion"]);
export type CriterionType = z.infer<typeof CriterionTypeSchema>;

export const CriterionVerdictSchema = z.enum(["met", "not_met", "unknown"]);
export type CriterionVerdict = z.infer<typeof CriterionVerdictSchema>;

export const CriterionAssessmentSchema = z.object({
  type: CriterionTypeSchema,
  text: z.string().trim().min(1).max(2000),
  source_span: z.string().max(2000).nullable().default(null),
  assessment: CriterionVerdictSchema,
  reasoning: z.string().trim().min(1).max(1200),
});
export type CriterionAssessment = z.infer<typeof CriterionAssessmentSchema>;

// The raw Claude output for one trial: a list of criterion assessments. The
// deterministic scorer (eligibility.ts) — never the model — computes the number.
export const TrialAssessmentLlmOutputSchema = z.object({
  criteria: z.array(CriterionAssessmentSchema).max(120).default([]),
});
export type TrialAssessmentLlmOutput = z.infer<typeof TrialAssessmentLlmOutputSchema>;

// The overall fit verdict for a trial — computed deterministically from the criteria.
export const TrialVerdictSchema = z.enum([
  "likely_eligible",
  "possibly_eligible",
  "likely_ineligible",
  "unknown",
]);
export type TrialVerdict = z.infer<typeof TrialVerdictSchema>;

// A fully assessed + scored trial match. `eligibility_score` is 0..1, deterministic.
export const TrialMatchSchema = z.object({
  nctId: z.string().min(1),
  title: z.string(),
  url: z.string(),
  phase: z.string().nullable(),
  overallStatus: z.string().nullable(),
  eligibility_score: z.number().min(0).max(1),
  verdict: TrialVerdictSchema,
  criteria: z.array(CriterionAssessmentSchema),
});
export type TrialMatch = z.infer<typeof TrialMatchSchema>;

// ---------------------------------------------------------------------------
// RUN + ROW TYPES — the persisted shapes returned by the repository and routes.
// ---------------------------------------------------------------------------

// Why a run produced fewer results than a healthy run would. `quota` = the Anthropic key is
// usage-capped / rate-limited (temporary, explainable); `error` = an unexpected failure. When
// present, the profile was still extracted but per-trial reasoning was skipped or partial —
// the run degrades honestly rather than fabricating scores. See lib/trialMatcher/errors.ts.
export type DegradedReason = "quota" | "error";

// The full result of runTrialMatch, before persistence. `degraded` is set only when the run
// completed in a degraded mode (profile extracted, but eligibility reasoning was unavailable);
// it is null on a fully healthy run.
export interface TrialMatchRunResult {
  profile: PatientProfile;
  matches: TrialMatch[];
  droppedUngrounded: number;
  degraded: DegradedReason | null;
}

// A persisted run header (trial_match_runs row), profile parsed back out of jsonb.
export interface TrialMatchRunRow {
  id: string;
  patient_summary: string | null;
  profile: PatientProfile;
  note_char_count: number | null;
  created_at: string;
  match_count: number;
}

// A persisted match (trial_matches row), criteria parsed back out of jsonb.
export interface TrialMatchRow {
  id: string;
  nct_id: string | null;
  title: string | null;
  url: string | null;
  phase: string | null;
  overall_status: string | null;
  eligibility_score: number | null;
  verdict: string | null;
  criteria: CriterionAssessment[];
  created_at: string;
}

// A run with its ranked matches (getRun result).
export interface TrialMatchRunDetail {
  run: TrialMatchRunRow;
  matches: TrialMatchRow[];
}

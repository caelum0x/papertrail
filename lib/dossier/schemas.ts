import { z } from "zod";

// Zod schemas for the EVIDENCE DOSSIER ORCHESTRATOR (lib/dossier/build.ts).
//
// PaperTrail's moat is provenance-grade, auditable evidence where Claude assembles
// and narrates but DETERMINISTIC engines verify every number. These schemas enforce
// that boundary at three seams:
//
//   1. The PUBLIC request body (never trust raw JSON at the API boundary).
//   2. The Claude PLAN — the model chooses WHICH deterministic sections to run for a
//      subject; the plan is validated to a closed set of section names, so a
//      hallucinated section can never route into an engine.
//   3. The Claude NARRATIVE — a plain-language executive summary written over the
//      already-verified sections. It carries no numbers or citations of its own; the
//      load-bearing figures live only on the sections (which the engines produced).
//
// No LLM decides the overall score or grade — those are computed deterministically in
// build.ts. Claude only plans (which checks) and narrates (prose over verified data).

// --- Subject ------------------------------------------------------------------

// The four subject kinds a dossier can be assembled for. Each routes to a different
// applicable set of deterministic checks (see DOSSIER_SECTIONS_BY_SUBJECT in build.ts).
export const SUBJECT_TYPES = ["target", "drug", "disease", "claim"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const SubjectTypeSchema = z.enum(SUBJECT_TYPES);

// Public request body. `subject` is the primary entity/claim text; `disease` is an
// optional disease context used by the association/efficacy checks when the subject is
// a target or drug (e.g. subject "PCSK9", disease "hypercholesterolemia").
export const DossierRequestSchema = z.object({
  subjectType: SubjectTypeSchema,
  subject: z.string().trim().min(1, "subject is required").max(500),
  disease: z.string().trim().min(1).max(300).optional(),
});
export type DossierRequest = z.infer<typeof DossierRequestSchema>;

// --- Section names (the closed vocabulary Claude may plan from) ---------------

// Every evidence section maps 1:1 to a deterministic engine. Keeping this a CLOSED
// enum is what makes the Claude plan safe: the planner may only pick from these, so a
// hallucinated section name fails validation and is dropped rather than run.
//
//   genetic_validation — verifyGeneticAssociation / targetDiseaseEvidence genetic axis
//   tractability       — Open Targets tractability (druggability of the target)
//   existing_drugs     — Open Targets known drugs / ChEMBL bioactivity
//   clinical_trials    — searchAndCache + runEvidencePipeline (efficacy claim pooling)
//   safety_liabilities — assessSafetySignal (FAERS disproportionality)
//   mechanism          — pubtator entity grounding of the mechanism
//   target_disease     — Open Targets overall association score
//   claim_verification — verifyBiomedicalClaim (the unified composite verifier)
export const SECTION_NAMES = [
  "genetic_validation",
  "tractability",
  "existing_drugs",
  "clinical_trials",
  "safety_liabilities",
  "mechanism",
  "target_disease",
  "claim_verification",
] as const;
export type SectionName = (typeof SECTION_NAMES)[number];
export const SectionNameSchema = z.enum(SECTION_NAMES);

// --- Claude plan --------------------------------------------------------------

// What the planner returns: an ordered list of the section names it deems relevant to
// the subject, plus a one-line rationale. Validated against the closed enum above;
// build.ts intersects this with the subject-type's applicable set, so Claude can only
// ever NARROW the deterministic checks, never invent one.
export const DossierPlanSchema = z.object({
  sections: z.array(SectionNameSchema).min(1).max(SECTION_NAMES.length),
  rationale: z.string().trim().min(1).max(1000),
});
export type DossierPlan = z.infer<typeof DossierPlanSchema>;

// --- Section signal → deterministic score contribution ------------------------

// A section's coarse deterministic signal, derived purely from its engine verdict.
// This is what the overall-score weighting reasons over (build.ts). Documented set:
//   strong   — engine returned confident supporting evidence (e.g. genome-wide,
//              a known drug present, a scored association).
//   moderate — supporting but weaker (e.g. suggestive genetics, moderate PGx).
//   present  — the check ran and found the thing exists, without a strength grade
//              (e.g. tractability buckets satisfied, mechanism entities grounded).
//   flag     — a risk/contradiction the dossier must surface (e.g. a safety signal,
//              an overstated claim). Lowers overall confidence.
//   empty    — honest not-found; contributes no evidence either way.
export const SECTION_SIGNALS = [
  "strong",
  "moderate",
  "present",
  "flag",
  "empty",
] as const;
export type SectionSignal = (typeof SECTION_SIGNALS)[number];
export const SectionSignalSchema = z.enum(SECTION_SIGNALS);

// One citation: a stable, human-checkable pointer to the source the engine used.
export const DossierCitationSchema = z.object({
  source: z.string(), // e.g. "EBI GWAS Catalog", "Open Targets Platform"
  ref: z.string().nullable(), // e.g. a PMID, NCT id, ChEMBL id, Ensembl id
  detail: z.string().nullable(), // short human label
});
export type DossierCitation = z.infer<typeof DossierCitationSchema>;

// A completed evidence section: the engine's verdict, its coarse signal, the
// per-section deterministic score in [0,1], its citations, and a short human summary.
// `detail` carries the verbatim engine result for full auditability.
export const DossierSectionSchema = z.object({
  name: SectionNameSchema,
  verdict: z.string(),
  signal: SectionSignalSchema,
  score: z.number().min(0).max(1),
  summary: z.string(),
  citations: z.array(DossierCitationSchema),
  // The raw engine output; unknown shape by design (each engine differs) but always
  // present so nothing about the section is unsourced.
  detail: z.unknown(),
});
export type DossierSection = z.infer<typeof DossierSectionSchema>;

// --- Overall grade ------------------------------------------------------------

// The overall dossier grade, STRONGEST → WEAKEST, plus `contradicted` for the case
// where the verified evidence actively contradicts the subject (a flagged claim).
export const DOSSIER_GRADES = [
  "strong",
  "moderate",
  "emerging",
  "weak",
  "contradicted",
] as const;
export type DossierGrade = (typeof DOSSIER_GRADES)[number];
export const DossierGradeSchema = z.enum(DOSSIER_GRADES);

// --- Claude narrative ---------------------------------------------------------

// The executive-summary narrative Claude writes OVER the verified sections. It has no
// numeric authority: it may reference only what the sections already contain. Kept in
// its own schema so the narrator prompt validates independently of the whole dossier.
export const DossierNarrativeSchema = z.object({
  headline: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(4000),
});
export type DossierNarrative = z.infer<typeof DossierNarrativeSchema>;

// --- Full dossier -------------------------------------------------------------

// The complete result the orchestrator returns and the route serializes. `overallScore`
// and `overallGrade` are computed deterministically from the section signals; the
// `narrative` is additive prose (null when the narrator failed — the verified sections
// and score always stand on their own).
export const EvidenceDossierSchema = z.object({
  subjectType: SubjectTypeSchema,
  subject: z.string(),
  disease: z.string().nullable(),
  planRationale: z.string().nullable(),
  sections: z.array(DossierSectionSchema),
  overallScore: z.number().min(0).max(1),
  overallGrade: DossierGradeSchema,
  narrative: DossierNarrativeSchema.nullable(),
});
export type EvidenceDossier = z.infer<typeof EvidenceDossierSchema>;

// EVIDENCE DOSSIER ORCHESTRATOR — the flagship.
//
// Given a subject (target gene / drug / disease / free-text claim), this autonomously
// assembles a COMPLETE, verified, cited, TRUST-SCORED evidence dossier by composing the
// existing deterministic bio/evidence engines. The division of labour is the whole point
// of the product and is enforced structurally here:
//
//   • Claude PLANS which evidence sections are relevant to the subject type
//     (callClaudeForJson + Zod), and Claude NARRATES an executive summary over the
//     already-verified sections (callClaudeForJson + Zod). That is ALL the LLM does.
//   • DETERMINISTIC engines fill every section with real, cited data, and a
//     DETERMINISTIC, documented weighting computes the overall confidence 0–1 and the
//     overall grade. NO LLM is ever in a load-bearing number or verdict.
//
// The planner can only NARROW the deterministic checks: its output is intersected with
// the subject-type's applicable section set, so a hallucinated section is dropped, never
// run. The narrator can only describe what the sections already contain: it is handed a
// numbers-free digest and its prose is additive — a narrator failure still returns the
// verified sections and the deterministic score/grade.
//
// Every external call is behind an INJECTABLE `deps` object (mirroring
// lib/bio/verifyBiomedicalClaim.ts) so the whole orchestrator runs OFFLINE against
// mocked engines + a mocked Claude planner/narrator in the test-suite — no live network,
// no real LLM. On any engine failure the section is dropped (honest omission) rather than
// fabricated.

import { callClaudeForJson } from "../claude";

import { verifyGeneticAssociation } from "../bio/geneticAssociation";
import type { GeneticDeps } from "../bio/geneticAssociation";
import type { GeneticAssociationResult } from "../bio/genetics.schemas";

import { targetDiseaseEvidence } from "../bio/openTargets";
import type { OpenTargetsDeps } from "../bio/openTargets";
import type { TargetDiseaseEvidence } from "../bio/targets.schemas";

import { verifyBioactivityClaim } from "../bio/chembl";
import type { ChemblDeps } from "../bio/chembl";
import type { BioactivityVerification } from "../bio/chembl.schemas";

import { assessSafetySignal } from "../bio/pharmacovigilance";
import type { FaersDeps, SafetySignalAssessment } from "../bio/pharmacovigilance";

import { annotateText, normalizeEntities } from "../bio/pubtator";
import type { PubtatorDeps } from "../bio/pubtator";
import type { NormalizedEntityGroup } from "../bio/entities.schemas";

import { verifyBiomedicalClaim } from "../bio/verifyBiomedicalClaim";
import type { BiomedicalDeps } from "../bio/verifyBiomedicalClaim";
import type { BiomedicalClaimVerification } from "../bio/biomedical.schemas";

import {
  DossierPlanSchema,
  DossierNarrativeSchema,
  EvidenceDossierSchema,
  SECTION_NAMES,
  type DossierCitation,
  type DossierGrade,
  type DossierNarrative,
  type DossierPlan,
  type DossierSection,
  type EvidenceDossier,
  type SectionName,
  type SectionSignal,
  type SubjectType,
} from "./schemas";

// ---------------------------------------------------------------------------
// Applicable sections per subject type. This is the DETERMINISTIC routing table:
// Claude's plan is intersected with the subject's row, so the model can only ever
// choose a subset of these — never introduce a check that doesn't apply to the subject.
// ---------------------------------------------------------------------------
export const DOSSIER_SECTIONS_BY_SUBJECT: Readonly<
  Record<SubjectType, readonly SectionName[]>
> = {
  // A target gene: is it genetically validated for the disease, druggable, already
  // drugged, and does it carry safety liabilities? Plus its mechanism grounding.
  target: [
    "genetic_validation",
    "target_disease",
    "tractability",
    "existing_drugs",
    "safety_liabilities",
    "mechanism",
  ],
  // A drug: what does it hit and how potently, is there a disease association, does it
  // carry a pharmacovigilance signal, and (with a disease) is there trial efficacy?
  drug: [
    "existing_drugs",
    "target_disease",
    "safety_liabilities",
    "clinical_trials",
    "mechanism",
  ],
  // A disease: which trials exist and what does the mechanism grounding say. (Target/
  // drug axes require a specific target/drug the disease subject doesn't name.)
  disease: ["clinical_trials", "mechanism"],
  // A free-text claim: the unified composite verifier is the load-bearing check; the
  // efficacy pipeline adds pooled trial evidence when the claim is efficacy-shaped.
  claim: ["claim_verification", "clinical_trials", "mechanism"],
} as const;

// ---------------------------------------------------------------------------
// Injectable deps — one field per engine, all optional. Tests supply mocks; production
// leaves them undefined and each engine uses its own live default deps. This is the
// single side-effecting surface (network + LLM); nothing else here touches the outside.
// ---------------------------------------------------------------------------
export interface DossierDeps {
  // Claude planner + narrator. Both optional so a test can inject deterministic stubs,
  // and either can fail independently without sinking the deterministic dossier.
  plan?: (input: {
    subjectType: SubjectType;
    subject: string;
    disease: string | null;
    applicable: readonly SectionName[];
  }) => Promise<DossierPlan>;
  narrate?: (input: {
    subjectType: SubjectType;
    subject: string;
    sections: readonly DossierSection[];
    overallScore: number;
    overallGrade: DossierGrade;
  }) => Promise<DossierNarrative>;

  // The composed deterministic engines. Each mirrors its module's public signature so a
  // mock is a drop-in. Undefined in production → the real engine with its live default.
  geneticAssociation?: typeof verifyGeneticAssociation;
  targetDisease?: typeof targetDiseaseEvidence;
  bioactivity?: typeof verifyBioactivityClaim;
  safetySignal?: typeof assessSafetySignal;
  annotate?: (text: string) => Promise<NormalizedEntityGroup[]>;
  biomedicalClaim?: typeof verifyBiomedicalClaim;
  // Efficacy pipeline: injected as a single closure so the dossier never touches the DB
  // directly. Returns the pooled report + citation trail, or null when unavailable.
  clinicalTrials?: (input: {
    claim: string;
    query?: string;
  }) => Promise<ClinicalTrialsResult | null>;

  // Passthrough deps for the real engines when no mock is supplied.
  geneticDeps?: GeneticDeps;
  openTargetsDeps?: OpenTargetsDeps;
  chemblDeps?: ChemblDeps;
  faersDeps?: FaersDeps;
  pubtatorDeps?: PubtatorDeps;
  biomedicalDeps?: BiomedicalDeps;
}

// The minimal shape the dossier needs from the efficacy pipeline. Kept structural so the
// production adapter (runEvidencePipeline over a real pool) and a test stub both fit.
export interface ClinicalTrialsResult {
  usableStudies: number;
  usedSourceCount: number;
  poolable: boolean; // the report produced a pooled estimate (report.ok === true)
  citations: DossierCitation[];
  detail: unknown; // the verbatim pipeline result, for auditability
}

// ---------------------------------------------------------------------------
// Deterministic SCORING. Each signal maps to a numeric contribution and each section
// name to a weight. The overall score is a weighted average of the per-section signal
// values across the sections that RAN (empty sections still count as an honest 0 — they
// were checked and found nothing). NO LLM is anywhere in these numbers.
// ---------------------------------------------------------------------------

// Signal → base evidence value in [0,1]. Documented, fixed (not tuned):
//   strong 1.0, moderate 0.6, present 0.4, empty 0.0. `flag` is handled separately
//   (it does not contribute an evidence value; it applies a documented penalty and can
//   force `contradicted`), so it is excluded from this map.
const SIGNAL_VALUE: Readonly<Record<Exclude<SectionSignal, "flag">, number>> = {
  strong: 1.0,
  moderate: 0.6,
  present: 0.4,
  empty: 0.0,
};

// Per-section weights for the weighted average. Genetic validation and the composite
// claim verdict are the strongest evidence of real support, so they weigh most; the
// druggability/mechanism axes are supporting context and weigh less. Fixed constants.
const SECTION_WEIGHT: Readonly<Record<SectionName, number>> = {
  genetic_validation: 3,
  claim_verification: 3,
  target_disease: 2,
  clinical_trials: 2,
  existing_drugs: 2,
  safety_liabilities: 1,
  tractability: 1,
  mechanism: 1,
};

// A safety/contradiction flag applies a fixed penalty to the overall score (per flagged
// section), reflecting that a surfaced liability lowers confidence in the subject.
const FLAG_PENALTY = 0.15;

// Grade cut-points on the final overall score. Documented, fixed:
//   >= 0.75 strong, >= 0.50 moderate, >= 0.25 emerging, else weak.
// A `contradicted` grade is decided separately (see gradeDossier) when the verified
// evidence actively contradicts the subject.
const GRADE_STRONG = 0.75;
const GRADE_MODERATE = 0.5;
const GRADE_EMERGING = 0.25;

/**
 * Compute the overall dossier confidence in [0,1] DETERMINISTICALLY from the section
 * signals. Weighted average of each section's signal value (weighted by SECTION_WEIGHT),
 * minus a fixed FLAG_PENALTY per flagged section, clamped to [0,1]. Pure — same sections
 * in, same score out; NO LLM. Returns 0 when no section ran (nothing to be confident in).
 */
export function computeOverallScore(
  sections: readonly Pick<DossierSection, "name" | "signal">[]
): number {
  if (sections.length === 0) return 0;

  let weightSum = 0;
  let weighted = 0;
  let flags = 0;

  for (const s of sections) {
    const weight = SECTION_WEIGHT[s.name];
    weightSum += weight;
    if (s.signal === "flag") {
      flags += 1;
      // A flag contributes no positive evidence value; it only penalizes below.
      continue;
    }
    weighted += weight * SIGNAL_VALUE[s.signal];
  }

  const base = weightSum > 0 ? weighted / weightSum : 0;
  const penalized = base - flags * FLAG_PENALTY;
  return clamp01(penalized);
}

/**
 * Grade the dossier DETERMINISTICALLY. `contradicted` when the evidence actively
 * contradicts the subject (any flagged section AND no strong/moderate supporting
 * section to offset it — the surfaced liability isn't outweighed by validation).
 * Otherwise banded by the overall score. Pure; NO LLM.
 */
export function gradeDossier(
  sections: readonly Pick<DossierSection, "signal">[],
  overallScore: number
): DossierGrade {
  const hasFlag = sections.some((s) => s.signal === "flag");
  const hasSupport = sections.some(
    (s) => s.signal === "strong" || s.signal === "moderate"
  );
  if (hasFlag && !hasSupport) return "contradicted";

  if (overallScore >= GRADE_STRONG) return "strong";
  if (overallScore >= GRADE_MODERATE) return "moderate";
  if (overallScore >= GRADE_EMERGING) return "emerging";
  return "weak";
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ---------------------------------------------------------------------------
// Section builders. Each takes the resolved engines + the subject context and returns a
// finished DossierSection, or null when its inputs are absent / the engine returned
// nothing runnable. Every builder maps its engine's verdict to a SectionSignal via a
// small documented function, and attaches citations back to the source the engine used.
// ---------------------------------------------------------------------------

function geneticSignalOf(v: GeneticAssociationResult["verdict"]): SectionSignal {
  switch (v) {
    case "genome_wide_significant":
    case "clinvar_pathogenic":
      return "strong";
    case "suggestive":
      return "moderate";
    case "reported_not_significant":
    case "conflicting":
      return "flag";
    case "no_association_found":
      return "empty";
  }
}

function geneticCitations(res: GeneticAssociationResult): DossierCitation[] {
  const out: DossierCitation[] = [];
  for (const g of res.supporting.gwas.slice(0, 5)) {
    out.push({
      source: "EBI GWAS Catalog",
      ref: g.study ?? g.rsId,
      detail: g.trait,
    });
  }
  for (const c of res.supporting.clinvar.slice(0, 5)) {
    out.push({
      source: "NCBI ClinVar",
      ref: c.variant,
      detail: c.clinicalSignificance,
    });
  }
  return out;
}

// Open Targets association: the OVERALL score bands the section, and the GENETIC datatype
// score decides the genetic_validation section when that's the one we're filling.
function targetDiseaseCitations(ev: TargetDiseaseEvidence): DossierCitation[] {
  const out: DossierCitation[] = [];
  if (ev.target.ensemblId) {
    out.push({ source: "Open Targets Platform", ref: ev.target.ensemblId, detail: "target" });
  }
  if (ev.disease.efoId) {
    out.push({ source: "Open Targets Platform", ref: ev.disease.efoId, detail: "disease" });
  }
  return out;
}

// Overall association score → signal. >=0.5 strong, >=0.1 moderate, >0 present, else empty.
function scoreSignal(score: number | null): SectionSignal {
  if (score === null) return "empty";
  if (score >= 0.5) return "strong";
  if (score >= 0.1) return "moderate";
  if (score > 0) return "present";
  return "empty";
}

function bioactivitySignalOf(v: BioactivityVerification): SectionSignal {
  if (v.potency.verdict === "overstated" || v.phase.verdict === "overstated") {
    return "flag";
  }
  if (
    v.potency.verdict === "confirmed_within_order" ||
    v.phase.verdict === "confirmed" ||
    v.mechanism.verdict === "consistent"
  ) {
    return "strong";
  }
  if (v.supporting.length > 0) return "present";
  return "empty";
}

function bioactivityCitations(v: BioactivityVerification): DossierCitation[] {
  const out: DossierCitation[] = [];
  if (v.molecule.chemblId) {
    out.push({ source: "ChEMBL (EMBL-EBI)", ref: v.molecule.chemblId, detail: v.molecule.prefName });
  }
  for (const a of v.supporting.slice(0, 4)) {
    out.push({
      source: "ChEMBL (EMBL-EBI)",
      ref: a.targetChemblId,
      detail: a.standardType && a.standardValue !== null ? `${a.standardType} ${a.standardValue} nM` : a.targetName,
    });
  }
  return out;
}

function biomedicalSignalOf(
  v: BiomedicalClaimVerification["overallVerdict"]
): SectionSignal {
  switch (v) {
    case "supported":
      return "strong";
    case "partially_supported":
      return "moderate";
    case "overstated":
    case "unsupported":
      return "flag";
    case "insufficient_evidence":
      return "empty";
  }
}

function biomedicalCitations(v: BiomedicalClaimVerification): DossierCitation[] {
  return v.checks.slice(0, 8).map((c) => ({
    source: c.source,
    ref: null,
    detail: c.kind,
  }));
}

// ---------------------------------------------------------------------------
// Engine resolution — pick the mock if provided, else the real engine bound to its
// passthrough deps. Mirrors verifyBiomedicalClaim.resolveEngines.
// ---------------------------------------------------------------------------
function resolveEngines(deps: DossierDeps) {
  return {
    geneticAssociation:
      deps.geneticAssociation ??
      ((req: Parameters<typeof verifyGeneticAssociation>[0]) =>
        verifyGeneticAssociation(req, deps.geneticDeps)),
    targetDisease:
      deps.targetDisease ??
      ((t: string, d: string) => targetDiseaseEvidence(t, d, deps.openTargetsDeps)),
    bioactivity:
      deps.bioactivity ??
      ((claim: Parameters<typeof verifyBioactivityClaim>[0]) =>
        verifyBioactivityClaim(claim, deps.chemblDeps)),
    safetySignal:
      deps.safetySignal ??
      ((drug: string, event: string) => assessSafetySignal(drug, event, deps.faersDeps)),
    annotate:
      deps.annotate ??
      (async (text: string) => {
        const annotations = await annotateText(text, deps.pubtatorDeps);
        const flat = annotations.flatMap((a) => a.entities);
        return normalizeEntities(flat);
      }),
    biomedicalClaim:
      deps.biomedicalClaim ??
      ((req: Parameters<typeof verifyBiomedicalClaim>[0]) =>
        verifyBiomedicalClaim(req, deps.biomedicalDeps)),
    clinicalTrials: deps.clinicalTrials,
  };
}

type ResolvedEngines = ReturnType<typeof resolveEngines>;

// ---------------------------------------------------------------------------
// Per-section runners. Keyed by section name; each returns a finished section or null.
// The subject/disease context is threaded so a builder can decide it has nothing to run.
// ---------------------------------------------------------------------------

interface RunContext {
  subjectType: SubjectType;
  subject: string;
  disease: string | null;
}

async function runGeneticValidation(
  engines: ResolvedEngines,
  ctx: RunContext
): Promise<DossierSection | null> {
  if (!ctx.disease) return null;
  const isVariant = /^rs\d+$/i.test(ctx.subject);
  const res = await engines.geneticAssociation({
    gene: isVariant ? undefined : ctx.subject,
    variant: isVariant ? ctx.subject : undefined,
    disease: ctx.disease,
  });
  const signal = geneticSignalOf(res.verdict);
  return {
    name: "genetic_validation",
    verdict: res.verdict,
    signal,
    score: signalScore(signal),
    summary: res.rationale,
    citations: geneticCitations(res),
    detail: res,
  };
}

async function runTargetDisease(
  engines: ResolvedEngines,
  ctx: RunContext
): Promise<DossierSection | null> {
  if (!ctx.disease) return null;
  const res = await engines.targetDisease(ctx.subject, ctx.disease);
  const signal = scoreSignal(res.found ? res.overallScore : null);
  return {
    name: "target_disease",
    verdict: res.found ? "association_found" : "no_association_found",
    signal,
    score: signalScore(signal),
    summary: res.found
      ? `Open Targets reports an overall association score of ${res.overallScore?.toFixed(3)} for ${ctx.subject} × ${ctx.disease}.`
      : `Open Targets reports no scored association for ${ctx.subject} × ${ctx.disease}.`,
    citations: targetDiseaseCitations(res),
    detail: res,
  };
}

async function runTractability(
  engines: ResolvedEngines,
  ctx: RunContext
): Promise<DossierSection | null> {
  // Tractability is a target-level Open Targets field. We reuse the association lookup
  // (which carries tractability) using the disease when present, else the subject as its
  // own disease context is meaningless — so require a disease to resolve the target node.
  if (!ctx.disease) return null;
  const res = await engines.targetDisease(ctx.subject, ctx.disease);
  const satisfied = res.tractability.filter((t) => t.value);
  const signal: SectionSignal = satisfied.length > 0 ? "present" : "empty";
  return {
    name: "tractability",
    verdict: satisfied.length > 0 ? "tractable" : "no_tractability_evidence",
    signal,
    score: signalScore(signal),
    summary:
      satisfied.length > 0
        ? `Open Targets lists ${satisfied.length} satisfied tractability bucket(s) for ${ctx.subject}.`
        : `Open Targets reports no satisfied tractability bucket for ${ctx.subject}.`,
    citations: targetDiseaseCitations(res),
    detail: res.tractability,
  };
}

async function runExistingDrugs(
  engines: ResolvedEngines,
  ctx: RunContext
): Promise<DossierSection | null> {
  // For a target subject, "existing drugs" is best answered by Open Targets known drugs;
  // for a drug subject, by ChEMBL bioactivity. We branch on subject type.
  if (ctx.subjectType === "drug") {
    const res = await engines.bioactivity({ drug: ctx.subject });
    const signal = bioactivitySignalOf(res);
    return {
      name: "existing_drugs",
      verdict: res.molecule.chemblId ? "resolved" : "not_found",
      signal,
      score: signalScore(signal),
      summary: res.rationale || `ChEMBL resolution for ${ctx.subject}.`,
      citations: bioactivityCitations(res),
      detail: res,
    };
  }
  // Target subject: known drugs come from the Open Targets association node.
  if (!ctx.disease) return null;
  const res = await engines.targetDisease(ctx.subject, ctx.disease);
  const drugCount = res.knownDrugs.length;
  const signal: SectionSignal = drugCount > 0 ? "strong" : "empty";
  return {
    name: "existing_drugs",
    verdict: drugCount > 0 ? "known_drugs_present" : "no_known_drugs",
    signal,
    score: signalScore(signal),
    summary:
      drugCount > 0
        ? `Open Targets lists ${drugCount} known drug(s) against ${ctx.subject}.`
        : `Open Targets lists no known drug against ${ctx.subject}.`,
    citations: res.knownDrugs.slice(0, 6).map((d) => ({
      source: "Open Targets Platform",
      ref: d.drugId,
      detail: d.drugName ?? d.mechanismOfAction,
    })),
    detail: res.knownDrugs,
  };
}

async function runSafetyLiabilities(
  engines: ResolvedEngines,
  ctx: RunContext
): Promise<DossierSection | null> {
  if (!ctx.disease) return null;
  const res = await engines.safetySignal(ctx.subject, ctx.disease);
  if (res === null) {
    return {
      name: "safety_liabilities",
      verdict: "no_signal_assessed",
      signal: "empty",
      score: signalScore("empty"),
      summary: `FAERS disproportionality could not assemble counts for ${ctx.subject} × ${ctx.disease}.`,
      citations: [{ source: "FDA FAERS (openFDA)", ref: null, detail: "no counts" }],
      detail: null,
    };
  }
  // A detected disproportionality signal is a LIABILITY to surface — it lowers confidence,
  // so it maps to `flag` (not positive evidence). No signal is an honest empty.
  const signal: SectionSignal = res.signal ? "flag" : "empty";
  return {
    name: "safety_liabilities",
    verdict: res.signal ? "signal_detected" : "no_signal",
    signal,
    score: signalScore(signal),
    summary: res.signal
      ? `FAERS disproportionality flags a signal (PRR=${res.prr.toFixed(2)}, a=${res.a}, Yates χ²=${res.chiSquaredYates.toFixed(2)}).`
      : `FAERS disproportionality does not flag a signal (PRR=${res.prr.toFixed(2)}, a=${res.a}).`,
    citations: [{ source: "FDA FAERS (openFDA)", ref: null, detail: `${res.drug} / ${res.event}` }],
    detail: res,
  };
}

async function runMechanism(
  engines: ResolvedEngines,
  ctx: RunContext
): Promise<DossierSection | null> {
  const text = ctx.disease ? `${ctx.subject} in ${ctx.disease}` : ctx.subject;
  const groups = await engines.annotate(text);
  const linked = groups.filter((g) => g.normalizedId !== null);
  const signal: SectionSignal = linked.length > 0 ? "present" : "empty";
  return {
    name: "mechanism",
    verdict: linked.length > 0 ? "entities_grounded" : "no_entities_grounded",
    signal,
    score: signalScore(signal),
    summary:
      linked.length > 0
        ? `PubTator grounded ${linked.length} normalized biomedical entit${linked.length === 1 ? "y" : "ies"} in the subject text.`
        : "PubTator grounded no normalized biomedical entity in the subject text.",
    citations: linked.slice(0, 8).map((g) => ({
      source: "NCBI PubTator3",
      ref: g.normalizedId,
      detail: g.mentions[0] ?? g.type,
    })),
    detail: groups,
  };
}

async function runClaimVerification(
  engines: ResolvedEngines,
  ctx: RunContext
): Promise<DossierSection | null> {
  const res = await engines.biomedicalClaim({ claim: ctx.subject });
  const signal = biomedicalSignalOf(res.overallVerdict);
  return {
    name: "claim_verification",
    verdict: res.overallVerdict,
    signal,
    score: signalScore(signal),
    summary: res.rationale,
    citations: biomedicalCitations(res),
    detail: res,
  };
}

async function runClinicalTrials(
  engines: ResolvedEngines,
  ctx: RunContext
): Promise<DossierSection | null> {
  if (!engines.clinicalTrials) return null;
  const claim = ctx.subject;
  const query = ctx.disease ? `${ctx.subject} ${ctx.disease}` : undefined;
  const res = await engines.clinicalTrials({ claim, query });
  if (res === null) return null;
  // Poolable evidence (≥2 usable studies + a pooled estimate) is strong; some usable
  // studies but no pool is present; nothing usable is an honest empty.
  const signal: SectionSignal =
    res.poolable && res.usableStudies >= 2
      ? "strong"
      : res.usableStudies > 0
        ? "present"
        : "empty";
  return {
    name: "clinical_trials",
    verdict: res.poolable ? "pooled_evidence" : res.usableStudies > 0 ? "sources_found" : "no_evidence",
    signal,
    score: signalScore(signal),
    summary: res.poolable
      ? `The efficacy pipeline pooled ${res.usableStudies} usable stud${res.usableStudies === 1 ? "y" : "ies"} from ${res.usedSourceCount} retrieved source(s).`
      : `The efficacy pipeline found ${res.usedSourceCount} source(s) but could not pool a confident estimate.`,
    citations: res.citations,
    detail: res.detail,
  };
}

// Section signal → per-section score in [0,1] for the section object's own `score` field.
// Mirrors SIGNAL_VALUE, with `flag` surfaced as 0 (a flag is a liability, not evidence).
function signalScore(signal: SectionSignal): number {
  if (signal === "flag") return 0;
  return SIGNAL_VALUE[signal];
}

const SECTION_RUNNERS: Readonly<
  Record<SectionName, (engines: ResolvedEngines, ctx: RunContext) => Promise<DossierSection | null>>
> = {
  genetic_validation: runGeneticValidation,
  target_disease: runTargetDisease,
  tractability: runTractability,
  existing_drugs: runExistingDrugs,
  safety_liabilities: runSafetyLiabilities,
  mechanism: runMechanism,
  claim_verification: runClaimVerification,
  clinical_trials: runClinicalTrials,
};

// ---------------------------------------------------------------------------
// Claude PLANNER (default). Given the subject + the applicable section set, Claude picks
// the relevant subset. Its output is Zod-validated AND intersected with `applicable` in
// the caller — so it can only narrow, never invent. On any failure the caller falls back
// to running every applicable section (a plan failure never sinks the dossier).
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = [
  "You plan an evidence dossier for a translational-research audience. You are given a",
  "SUBJECT (a target gene, drug, disease, or claim), an optional disease context, and the",
  "CLOSED LIST of evidence sections that are technically applicable to this subject type.",
  "",
  "Your ONLY job is to choose WHICH of the applicable sections are worth running for this",
  "specific subject. You do NOT run any check, produce any number, or judge any evidence —",
  "deterministic engines do that. Choose sections; do not invent them.",
  "",
  "Return ONLY a JSON object with exactly these keys:",
  '  "sections": an array of section names, each EXACTLY one of the applicable names given,',
  "              with no duplicates. Prefer including all applicable sections unless one is",
  "              clearly irrelevant to this subject.",
  '  "rationale": one sentence explaining the selection.',
].join("\n");

function plannerUser(input: {
  subjectType: SubjectType;
  subject: string;
  disease: string | null;
  applicable: readonly SectionName[];
}): string {
  return [
    `Subject type: ${input.subjectType}`,
    `Subject: ${input.subject}`,
    `Disease context: ${input.disease ?? "none"}`,
    `Applicable sections (choose from these only): ${input.applicable.join(", ")}`,
  ].join("\n");
}

async function defaultPlan(input: {
  subjectType: SubjectType;
  subject: string;
  disease: string | null;
  applicable: readonly SectionName[];
}): Promise<DossierPlan> {
  return callClaudeForJson({
    system: PLANNER_SYSTEM,
    user: plannerUser(input),
    schema: DossierPlanSchema,
    maxTokens: 512,
  });
}

// ---------------------------------------------------------------------------
// Claude NARRATOR (default). Writes an executive summary OVER the verified sections. It
// is handed a numbers-light digest of the sections (name, verdict, signal, summary) plus
// the deterministic overall score/grade, and instructed to introduce no number or
// citation not already present. Its prose is additive — a narrator failure returns the
// verified sections + score without a narrative.
// ---------------------------------------------------------------------------

const NARRATOR_SYSTEM = [
  "You write a 2–5 sentence executive summary of an evidence dossier for a translational-",
  "research audience. You are given the ALREADY-VERIFIED sections (each with a verdict, a",
  "signal, and a one-line summary produced by deterministic engines) and the DETERMINISTIC",
  "overall score and grade.",
  "",
  "STRICT RULES:",
  "  • Describe ONLY what the sections say. Do NOT introduce any number, statistic, p-value,",
  "    score, or citation that is not already present in the section summaries provided.",
  "  • Do NOT contradict, re-grade, or recompute the overall grade/score — state it as given.",
  "  • Be plain, specific, and honest: if the evidence is weak or contradicted, say so.",
  "",
  "Return ONLY a JSON object with exactly these keys:",
  '  "headline": a short (<= 120 char) one-line verdict.',
  '  "summary": a 2–5 sentence plain-language summary over the sections.',
].join("\n");

function narratorUser(input: {
  subjectType: SubjectType;
  subject: string;
  sections: readonly DossierSection[];
  overallScore: number;
  overallGrade: DossierGrade;
}): string {
  const lines = input.sections.map(
    (s) => `- ${s.name} [${s.signal}] ${s.verdict}: ${s.summary}`
  );
  return [
    `Subject (${input.subjectType}): ${input.subject}`,
    `Deterministic overall grade: ${input.overallGrade} (score ${input.overallScore.toFixed(2)})`,
    "Verified sections:",
    ...lines,
  ].join("\n");
}

async function defaultNarrate(input: {
  subjectType: SubjectType;
  subject: string;
  sections: readonly DossierSection[];
  overallScore: number;
  overallGrade: DossierGrade;
}): Promise<DossierNarrative> {
  return callClaudeForJson({
    system: NARRATOR_SYSTEM,
    user: narratorUser(input),
    schema: DossierNarrativeSchema,
    maxTokens: 700,
  });
}

// ---------------------------------------------------------------------------
// The orchestrator.
// ---------------------------------------------------------------------------

/**
 * Assemble a complete, verified, cited, trust-scored evidence dossier for a subject.
 *
 * PIPELINE:
 *   1. Claude PLANS which of the subject-type's applicable sections to run (or the
 *      default planner). The plan is intersected with the applicable set — Claude can
 *      only narrow the deterministic checks, never invent one. A plan failure falls back
 *      to running every applicable section.
 *   2. Every planned section runs its DETERMINISTIC engine in parallel; a failing/absent
 *      section is dropped (honest omission), never fabricated.
 *   3. The overall confidence (0–1) and grade are computed DETERMINISTICALLY from the
 *      section signals — NO LLM decides the score.
 *   4. Claude NARRATES an executive summary over ONLY the verified sections. A narrator
 *      failure still returns the verified sections + deterministic score/grade.
 *
 * Every external call is injectable (`deps`) so the whole flow runs offline against mocks.
 */
export async function buildEvidenceDossier(
  request: { subjectType: SubjectType; subject: string; disease?: string },
  deps: DossierDeps = {}
): Promise<EvidenceDossier> {
  const subjectType = request.subjectType;
  const subject = request.subject.trim();
  const disease = request.disease?.trim() || null;

  const engines = resolveEngines(deps);
  const applicable = DOSSIER_SECTIONS_BY_SUBJECT[subjectType];

  // 1. PLAN — Claude chooses a subset of the applicable sections. On any failure, run all
  //    applicable sections (a plan failure must never sink the deterministic dossier).
  const planner = deps.plan ?? defaultPlan;
  let plannedSections: readonly SectionName[];
  let planRationale: string | null;
  try {
    const plan = await planner({ subjectType, subject, disease, applicable });
    // Intersect with the applicable set — the model can only ever NARROW, never invent.
    const allowed = new Set<SectionName>(applicable);
    const chosen = dedupeSections(plan.sections.filter((s) => allowed.has(s)));
    plannedSections = chosen.length > 0 ? chosen : applicable;
    planRationale = plan.rationale;
  } catch {
    plannedSections = applicable;
    planRationale = null;
  }

  // 2. RUN — every planned section's deterministic engine, in parallel. A thrown engine
  //    or a null (nothing to run) is dropped rather than fabricated.
  const ctx: RunContext = { subjectType, subject, disease };
  const settled = await Promise.all(
    plannedSections.map((name) =>
      SECTION_RUNNERS[name](engines, ctx).catch(() => null)
    )
  );
  const sections = settled.filter((s): s is DossierSection => s !== null);

  // 3. SCORE + GRADE — deterministic, documented weighting. NO LLM.
  const overallScore = computeOverallScore(sections);
  const overallGrade = gradeDossier(sections, overallScore);

  // 4. NARRATE — additive prose over the verified sections. Isolated: a narrator failure
  //    leaves `narrative` null and the verified sections + score/grade stand alone.
  let narrative: DossierNarrative | null = null;
  if (sections.length > 0) {
    const narrator = deps.narrate ?? defaultNarrate;
    try {
      narrative = await narrator({
        subjectType,
        subject,
        sections,
        overallScore,
        overallGrade,
      });
    } catch {
      narrative = null;
    }
  }

  const dossier: EvidenceDossier = {
    subjectType,
    subject,
    disease,
    planRationale,
    sections,
    overallScore,
    overallGrade,
    narrative,
  };

  // Defensive: validate the composed shape before it escapes this module.
  return EvidenceDossierSchema.parse(dossier);
}

// Preserve first-occurrence order while removing duplicate section names.
function dedupeSections(names: readonly SectionName[]): SectionName[] {
  const seen = new Set<SectionName>();
  const out: SectionName[] = [];
  for (const n of names) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

// Re-export the section vocabulary length check surface for callers/tests.
export { SECTION_NAMES };

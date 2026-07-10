// DRUG-REPURPOSING EVIDENCE BUNDLES — deterministically assemble the evidence for a
// proposed drug<->indication link out of the bio engines PaperTrail already built.
//
// MOAT: the composite `score` and `verdict` are a PURE, documented function of the
// component signals — NO LLM is anywhere in the numeric path. We compose four
// engines, each already deterministic on real open bio-data:
//   1. Open Targets  — does the drug's molecular target genetically associate with
//                      the indication? (genetic_association datatype score, verbatim)
//   2. ChEMBL        — how far has the molecule advanced (max_phase) and does it have
//                      measured bioactivity against the target? (CC BY-SA 3.0)
//   3. ClinicalTrials.gov — are there existing trials of this drug for this
//                      indication, INCLUDING failed ones? (public domain)
//   4. FDA FAERS     — pharmacovigilance disproportionality summary for the drug.
//
// We do NOT edit the underlying engines. Every external touchpoint is reached
// through an INJECTABLE `deps` object (mirroring lib/bio/openTargets.ts and
// lib/ingest/searchAndCache.ts) so the whole assembly runs fully OFFLINE in tests
// against mocked component signals. On any component failure we degrade to an HONEST
// empty signal for that component (never a fabricated value) and score on what's left.
//
// The OPTIONAL `summarize()` (callClaudeForJson + Zod) writes prose OVER the already-
// assembled evidence only; the score stays deterministic and is the source of truth.

import { callClaudeForJson } from "../claude";
import { targetDiseaseEvidence, type OpenTargetsDeps } from "./openTargets";
import {
  assessSafetySignal,
  type FaersDeps,
  type SafetySignalAssessment,
} from "./pharmacovigilance";
import { searchTrials, type TrialRecord } from "../sources/clinicaltrials";
import {
  RepurposingEvidenceSchema,
  RepurposingSummarySchema,
  type ExistingTrials,
  type Mechanism,
  type RepurposingEvidence,
  type RepurposingSummary,
  type RepurposingTrial,
  type RepurposingVerdict,
  type SafetySummary,
  type SharedTargets,
} from "./repurposing.schemas";
import type { KnownDrug } from "./targets.schemas";

// ---------------------------------------------------------------------------
// Documented composite weighting (fixed constants — NOT tuned to any example)
// ---------------------------------------------------------------------------
//
// The composite score is a weighted sum of four normalized component signals, each
// in [0,1], with weights summing to 1. The weighting reflects standard translational
// prioritization: human genetic support for the target-indication link is the single
// strongest predictor of clinical success (Nelson et al. 2015, Nat Genet — genetic
// support ~2x approval odds), so it carries the most weight; clinical advancement
// (max_phase) and prior trial activity are corroborating; safety is a penalty channel.
const W_GENETIC = 0.45; // shared-target genetic association (Open Targets)
const W_MECHANISM = 0.3; // ChEMBL max_phase advancement + bioactivity
const W_TRIALS = 0.25; // existing (non-failed) clinical activity for this indication

// Verdict thresholds on the composite score. Documented field-standard-style bands;
// deterministic, not example-fit. A failed trial OR a fired safety signal OVERRIDES
// the band to `discouraged` (a known negative outcome outweighs a promising score).
const STRONG_THRESHOLD = 0.6;
const PLAUSIBLE_THRESHOLD = 0.3;

// ChEMBL phase is 0..4; normalize to [0,1] as phase/4 (approved=1.0, preclinical=0).
const CHEMBL_MAX_PHASE = 4;

// A small bonus (within the mechanism channel) for measured target bioactivity on
// top of clinical-phase advancement — mechanistic plausibility beyond just "it's a
// drug." Capped so mechanism never exceeds 1.0 before weighting.
const BIOACTIVITY_BONUS = 0.15;

// Cap the number of trials we surface so a prolific drug can't balloon the response.
const MAX_TRIALS = 25;

// ClinicalTrials.gov overallStatus values that denote an UNAMBIGUOUS negative outcome.
// We only mark `failed` on these — never inferred from missing results. "COMPLETED"
// is NOT failure (a completed trial may be positive or negative; we don't guess).
const FAILED_TRIAL_STATUSES = new Set([
  "TERMINATED",
  "WITHDRAWN",
  "SUSPENDED",
]);

// ---------------------------------------------------------------------------
// Injectable dependencies — every external engine call goes through here so the
// assembly is fully offline-testable. Defaults wire the real engines.
// ---------------------------------------------------------------------------

// A ChEMBL lookup: drug name -> { chemblId, maxPhase, mechanismOfAction,
// hasTargetBioactivity, targetSymbol }. ChEMBL is CC BY-SA 3.0 (attribution +
// share-alike). Returns null on any failure — honest empty, never a fabricated phase.
export interface ChemblMechanism {
  chemblId: string | null;
  maxPhase: number | null;
  mechanismOfAction: string | null;
  hasTargetBioactivity: boolean;
  targetSymbol: string | null;
}

export type ChemblLookup = (drug: string) => Promise<ChemblMechanism | null>;

export interface RepurposingDeps {
  // Open Targets target<->disease association (drug's target vs the indication).
  targetDiseaseEvidence: typeof targetDiseaseEvidence;
  openTargetsDeps?: OpenTargetsDeps;
  // ChEMBL max_phase + mechanism + bioactivity for the drug.
  chemblLookup: ChemblLookup;
  // ClinicalTrials.gov search for trials of this drug in this indication.
  searchTrials: typeof searchTrials;
  // FAERS disproportionality assessment for the drug against the indication term.
  assessSafetySignal: typeof assessSafetySignal;
  faersDeps?: FaersDeps;
}

// Default ChEMBL lookup via the public ChEMBL REST API. Data: ChEMBL (CC BY-SA 3.0).
// Kept small + defensive: any failure yields null so the bundle degrades honestly.
const CHEMBL_BASE = "https://www.ebi.ac.uk/chembl/api/data";
const CHEMBL_TIMEOUT_MS = 10_000;

async function defaultChemblLookup(drug: string): Promise<ChemblMechanism | null> {
  const name = drug.trim();
  if (name.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHEMBL_TIMEOUT_MS);
  try {
    // Resolve the molecule by pref name (exact, case-insensitive) to get max_phase.
    const molUrl =
      `${CHEMBL_BASE}/molecule.json?pref_name__iexact=` +
      `${encodeURIComponent(name)}&limit=1`;
    const molRes = await fetch(molUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!molRes.ok) return null;
    const molJson = (await molRes.json()) as { molecules?: unknown };
    const molecules = Array.isArray(molJson?.molecules) ? molJson.molecules : [];
    const mol = (molecules[0] ?? null) as Record<string, unknown> | null;
    if (!mol) return null;

    const chemblId =
      typeof mol.molecule_chembl_id === "string" ? mol.molecule_chembl_id : null;
    const maxPhaseRaw = mol.max_phase;
    const maxPhase =
      typeof maxPhaseRaw === "number" && Number.isFinite(maxPhaseRaw)
        ? maxPhaseRaw
        : null;

    // Mechanism of action + target (best-effort; absence is honest null).
    let mechanismOfAction: string | null = null;
    let targetSymbol: string | null = null;
    let hasTargetBioactivity = false;
    if (chemblId) {
      const mechUrl =
        `${CHEMBL_BASE}/mechanism.json?molecule_chembl_id=` +
        `${encodeURIComponent(chemblId)}&limit=1`;
      const mechRes = await fetch(mechUrl, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (mechRes.ok) {
        const mechJson = (await mechRes.json()) as { mechanisms?: unknown };
        const mechs = Array.isArray(mechJson?.mechanisms) ? mechJson.mechanisms : [];
        const m = (mechs[0] ?? null) as Record<string, unknown> | null;
        if (m && typeof m.mechanism_of_action === "string") {
          mechanismOfAction = m.mechanism_of_action;
        }
        hasTargetBioactivity = mechs.length > 0;

        // Resolve the mechanism's ChEMBL target to a gene symbol so the Open
        // Targets genetic-association lookup can actually fire (ChEMBL target ids
        // are not gene symbols; the target's GENE_SYMBOL synonym is).
        const targetChemblId =
          m && typeof m.target_chembl_id === "string" ? m.target_chembl_id : null;
        if (targetChemblId) {
          const tgtRes = await fetch(
            `${CHEMBL_BASE}/target/${encodeURIComponent(targetChemblId)}.json`,
            { headers: { accept: "application/json" }, signal: controller.signal }
          );
          if (tgtRes.ok) {
            const tgtJson = (await tgtRes.json()) as { target_components?: unknown };
            const comps = Array.isArray(tgtJson?.target_components)
              ? (tgtJson.target_components as Record<string, unknown>[])
              : [];
            for (const comp of comps) {
              const syns = Array.isArray(comp?.target_component_synonyms)
                ? (comp.target_component_synonyms as Record<string, unknown>[])
                : [];
              const gene = syns.find(
                (s) => s?.syn_type === "GENE_SYMBOL" && typeof s?.component_synonym === "string"
              );
              if (gene) {
                targetSymbol = gene.component_synonym as string;
                break;
              }
            }
          }
        }
      }
    }

    return {
      chemblId,
      maxPhase,
      mechanismOfAction,
      hasTargetBioactivity,
      targetSymbol,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const defaultDeps: RepurposingDeps = {
  targetDiseaseEvidence,
  chemblLookup: defaultChemblLookup,
  searchTrials,
  assessSafetySignal,
};

// ---------------------------------------------------------------------------
// Component assembly — each returns an HONEST empty signal on failure
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Pull a usable target symbol for the drug: prefer ChEMBL's, else the mechanism string
// isn't a symbol so fall back to null. (Open Targets resolves by symbol; without one
// we simply report no shared-target association — honest, not fabricated.)
function pickTargetSymbol(chembl: ChemblMechanism | null): string | null {
  return chembl?.targetSymbol ?? null;
}

async function assembleSharedTargets(
  indication: string,
  targetSymbol: string | null,
  deps: RepurposingDeps
): Promise<SharedTargets> {
  const empty: SharedTargets = {
    targetSymbol,
    associationFound: false,
    overallScore: null,
    geneticScore: null,
  };
  if (!targetSymbol) return empty;

  try {
    const ev = await deps.targetDiseaseEvidence(
      targetSymbol,
      indication,
      deps.openTargetsDeps
    );
    return {
      targetSymbol,
      associationFound: ev.found,
      overallScore: ev.overallScore,
      geneticScore: ev.datatypeScores.genetic_association,
    };
  } catch {
    return empty;
  }
}

// If ChEMBL didn't identify the target, we can still recover a target symbol from
// Open Targets knownDrugs isn't available here; mechanism is what ChEMBL gives us.
function assembleMechanism(chembl: ChemblMechanism | null): Mechanism {
  if (!chembl) {
    return {
      chemblId: null,
      maxPhase: null,
      mechanismOfAction: null,
      hasTargetBioactivity: false,
    };
  }
  return {
    chemblId: chembl.chemblId,
    maxPhase: chembl.maxPhase,
    mechanismOfAction: chembl.mechanismOfAction,
    hasTargetBioactivity: chembl.hasTargetBioactivity,
  };
}

function classifyTrialFailed(status: string | null): boolean {
  if (!status) return false;
  return FAILED_TRIAL_STATUSES.has(status.trim().toUpperCase());
}

async function assembleExistingTrials(
  drug: string,
  indication: string,
  deps: RepurposingDeps
): Promise<ExistingTrials> {
  const empty: ExistingTrials = { trials: [], count: 0, hasFailedTrial: false };
  try {
    // A focused registry query: the drug AND the indication together.
    const records = await deps.searchTrials(`${drug} ${indication}`, MAX_TRIALS);
    const trials: RepurposingTrial[] = records
      .slice(0, MAX_TRIALS)
      .map((r: TrialRecord) => {
        // searchTrials surfaces phase but not overallStatus in TrialRecord; read it
        // defensively if a richer record was injected in tests.
        const status =
          typeof (r as unknown as { overallStatus?: unknown }).overallStatus ===
          "string"
            ? ((r as unknown as { overallStatus: string }).overallStatus)
            : null;
        return {
          nctId: r.nctId,
          title: r.title,
          phase: r.phase,
          overallStatus: status,
          failed: classifyTrialFailed(status),
        };
      });
    const hasFailedTrial = trials.some((t) => t.failed);
    return { trials, count: trials.length, hasFailedTrial };
  } catch {
    return empty;
  }
}

async function assembleSafety(
  drug: string,
  indication: string,
  deps: RepurposingDeps
): Promise<SafetySummary> {
  const empty: SafetySummary = {
    assessed: false,
    prr: null,
    ic025: null,
    signal: false,
  };
  try {
    // Assess disproportionate reporting of the indication itself as an adverse event
    // for the drug (a "condition worsening / lack of efficacy" style caution signal).
    const a: SafetySignalAssessment | null = await deps.assessSafetySignal(
      drug,
      indication,
      deps.faersDeps
    );
    if (!a) return empty;
    return {
      assessed: true,
      prr: Number.isFinite(a.prr) ? a.prr : null,
      ic025: Number.isFinite(a.ic025) ? a.ic025 : null,
      signal: a.signal,
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Deterministic composite score + verdict
// ---------------------------------------------------------------------------

// Normalize each component to [0,1], combine with fixed weights, then apply verdict
// bands with hard overrides for failed trials / safety signals. Pure function of the
// assembled signals — same inputs, same output, no randomness, no LLM.
export function scoreRepurposing(input: {
  sharedTargets: SharedTargets;
  mechanism: Mechanism;
  existingTrials: ExistingTrials;
  safety: SafetySummary;
}): { score: number; verdict: RepurposingVerdict; rationale: string } {
  const { sharedTargets, mechanism, existingTrials, safety } = input;

  // Genetic channel: the genetic_association score verbatim (null -> 0 contribution,
  // which is honest: no genetic evidence contributes nothing, not a penalty).
  const geneticSignal = clamp01(sharedTargets.geneticScore ?? 0);

  // Mechanism channel: clinical-phase advancement (phase/4) plus a bonus for measured
  // target bioactivity. Null phase -> 0 (unknown advancement contributes nothing).
  const phaseSignal =
    mechanism.maxPhase !== null
      ? clamp01(mechanism.maxPhase / CHEMBL_MAX_PHASE)
      : 0;
  const mechanismSignal = clamp01(
    phaseSignal + (mechanism.hasTargetBioactivity ? BIOACTIVITY_BONUS : 0)
  );

  // Trials channel: presence of NON-FAILED clinical activity for this indication is a
  // positive corroborating signal. Failed trials do NOT add here (and trigger the
  // override below). Any non-failed trial saturates this channel to 1.0.
  const nonFailedTrials = existingTrials.trials.filter((t) => !t.failed).length;
  const trialsSignal = nonFailedTrials > 0 ? 1 : 0;

  const rawScore =
    W_GENETIC * geneticSignal +
    W_MECHANISM * mechanismSignal +
    W_TRIALS * trialsSignal;
  const score = clamp01(rawScore);

  // Hard overrides: a known failed trial or a fired FAERS signal is a documented
  // negative outcome that outweighs a promising composite — verdict = discouraged.
  const discouraged = existingTrials.hasFailedTrial || safety.signal;

  let verdict: RepurposingVerdict;
  if (discouraged) {
    verdict = "discouraged";
  } else if (score >= STRONG_THRESHOLD) {
    verdict = "strong_rationale";
  } else if (score >= PLAUSIBLE_THRESHOLD) {
    verdict = "plausible";
  } else {
    verdict = "weak";
  }

  const rationale = buildRationale({
    verdict,
    score,
    geneticSignal,
    sharedTargets,
    mechanism,
    nonFailedTrials,
    existingTrials,
    safety,
  });

  return { score, verdict, rationale };
}

function buildRationale(x: {
  verdict: RepurposingVerdict;
  score: number;
  geneticSignal: number;
  sharedTargets: SharedTargets;
  mechanism: Mechanism;
  nonFailedTrials: number;
  existingTrials: ExistingTrials;
  safety: SafetySummary;
}): string {
  const parts: string[] = [];

  if (x.sharedTargets.geneticScore !== null) {
    parts.push(
      `target${x.sharedTargets.targetSymbol ? ` ${x.sharedTargets.targetSymbol}` : ""} ` +
        `genetically associates with the indication (genetic score ${x.sharedTargets.geneticScore.toFixed(2)})`
    );
  } else {
    parts.push("no genetic target-indication association found in Open Targets");
  }

  if (x.mechanism.maxPhase !== null) {
    parts.push(
      `ChEMBL reports the molecule at max clinical phase ${x.mechanism.maxPhase}` +
        (x.mechanism.hasTargetBioactivity ? " with measured target bioactivity" : "")
    );
  } else {
    parts.push("no ChEMBL clinical-phase information");
  }

  if (x.existingTrials.hasFailedTrial) {
    parts.push("an existing trial for this indication has an unambiguous negative outcome (terminated/withdrawn)");
  } else if (x.nonFailedTrials > 0) {
    parts.push(`${x.nonFailedTrials} existing non-failed trial(s) for this indication`);
  } else {
    parts.push("no existing trials found for this indication");
  }

  if (x.safety.signal) {
    parts.push("FAERS shows a disproportionate adverse-event reporting signal for this drug against the indication");
  }

  const lead =
    x.verdict === "strong_rationale"
      ? "Strong repurposing rationale"
      : x.verdict === "plausible"
        ? "Plausible repurposing rationale"
        : x.verdict === "discouraged"
          ? "Repurposing discouraged"
          : "Weak repurposing rationale";

  return `${lead} (composite ${x.score.toFixed(2)}): ${parts.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Assemble a deterministic drug-repurposing evidence bundle for a proposed
 * drug<->indication link. Composes Open Targets, ChEMBL, ClinicalTrials.gov, and
 * FAERS through injectable deps so it runs offline in tests. Every component
 * degrades to an honest empty signal on failure; the composite score/verdict are a
 * pure function of the assembled signals (NO LLM in the numeric path).
 */
export async function assembleRepurposingEvidence(
  request: { drug: string; indication: string },
  deps: RepurposingDeps = defaultDeps
): Promise<RepurposingEvidence> {
  const drug = request.drug.trim();
  const indication = request.indication.trim();

  // 1. ChEMBL first — it gives us mechanism + (optionally) the target symbol that
  //    Open Targets needs to test the genetic target-indication association.
  const chembl = await safeChembl(drug, deps);
  const targetSymbol = pickTargetSymbol(chembl);

  // 2. The remaining components are independent — assemble concurrently.
  const [sharedTargets, existingTrials, safety] = await Promise.all([
    assembleSharedTargets(indication, targetSymbol, deps),
    assembleExistingTrials(drug, indication, deps),
    assembleSafety(drug, indication, deps),
  ]);

  const mechanism = assembleMechanism(chembl);

  const { score, verdict, rationale } = scoreRepurposing({
    sharedTargets,
    mechanism,
    existingTrials,
    safety,
  });

  const evidence: RepurposingEvidence = {
    drug,
    indication,
    sharedTargets,
    mechanism,
    existingTrials,
    safety,
    score,
    verdict,
    rationale,
  };

  // Validate the assembled shape before returning (defensive; values already bounded).
  return RepurposingEvidenceSchema.parse(evidence);
}

async function safeChembl(
  drug: string,
  deps: RepurposingDeps
): Promise<ChemblMechanism | null> {
  try {
    return await deps.chemblLookup(drug);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// summarizeRepurposing — OPTIONAL, additive Claude layer. Writes plain-language prose
// ABOUT the deterministic bundle. The SCORE/VERDICT stay deterministic; the summary
// must only reference assembled data and is Zod-validated before use.
// ---------------------------------------------------------------------------

function bundleForPrompt(evidence: RepurposingEvidence): string {
  const s = (v: number | null) => (v === null ? "n/a" : v.toFixed(3));
  return [
    `Drug: ${evidence.drug}`,
    `Indication: ${evidence.indication}`,
    `Composite score: ${evidence.score.toFixed(3)}`,
    `Verdict: ${evidence.verdict}`,
    `Shared target: ${evidence.sharedTargets.targetSymbol ?? "unresolved"} ` +
      `(association found: ${evidence.sharedTargets.associationFound}, ` +
      `genetic score: ${s(evidence.sharedTargets.geneticScore)}, ` +
      `overall: ${s(evidence.sharedTargets.overallScore)})`,
    `Mechanism: ChEMBL ${evidence.mechanism.chemblId ?? "unresolved"}, ` +
      `max phase ${evidence.mechanism.maxPhase ?? "n/a"}, ` +
      `MoA ${evidence.mechanism.mechanismOfAction ?? "n/a"}, ` +
      `bioactivity ${evidence.mechanism.hasTargetBioactivity}`,
    `Existing trials: ${evidence.existingTrials.count} ` +
      `(failed trial present: ${evidence.existingTrials.hasFailedTrial})`,
    `Safety: assessed ${evidence.safety.assessed}, ` +
      `PRR ${s(evidence.safety.prr)}, IC025 ${s(evidence.safety.ic025)}, ` +
      `signal ${evidence.safety.signal}`,
  ].join("\n");
}

const SUMMARY_SYSTEM = [
  "You summarize a DRUG-REPURPOSING evidence bundle for a translational-research",
  "audience. You are given the assembled evidence and a DETERMINISTIC composite score",
  "and verdict VERBATIM. Do NOT invent, recompute, or contradict any value — in",
  "particular do NOT change the score or verdict. Reference only the target, mechanism,",
  "trials, and safety data provided. Do NOT claim evidence for a field shown as 'n/a'.",
  "",
  "Return ONLY a JSON object with exactly these keys:",
  '  "summary": a 2-4 sentence plain-language description of the repurposing rationale,',
  "             consistent with the provided verdict, noting the decisive evidence.",
  '  "keyDriver": one of "shared_target" | "mechanism" | "existing_trials" | "safety"',
  "             | null — the component that most drove the verdict, or null if unclear.",
].join("\n");

/**
 * OPTIONAL plain-language summary of a deterministic repurposing bundle. Calls Claude
 * and validates the result against RepurposingSummarySchema. Strictly additive: the
 * numeric score/verdict in `evidence` are unchanged and remain the source of truth.
 * Throws if Claude returns non-JSON or fails validation — the caller decides whether
 * to surface the bundle without a summary (it always can).
 */
export async function summarizeRepurposing(
  evidence: RepurposingEvidence,
  callJson: typeof callClaudeForJson = callClaudeForJson
): Promise<RepurposingSummary> {
  return callJson({
    system: SUMMARY_SYSTEM,
    user: bundleForPrompt(evidence),
    schema: RepurposingSummarySchema,
    maxTokens: 512,
  });
}

// Re-export for callers/tests that want the raw known-drug shape from Open Targets.
export type { KnownDrug };

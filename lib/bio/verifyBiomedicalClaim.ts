// UNIFIED BIOMEDICAL CLAIM VERIFIER — the capstone that composes PaperTrail's
// individual bio engines into ONE deterministic verdict.
//
// PaperTrail's moat is DETERMINISTIC biology on real open data with NO LLM in the
// load-bearing numeric/decision path. This module answers, for a free-text biomedical
// claim (e.g. "PCSK9 loss-of-function protects against coronary artery disease" or
// "Drug X is a 5 nM BRAF inhibitor in Phase 3"):
//
//   1. WHICH evidence checks even apply — decided by the ENTITIES PubTator resolves in
//      the claim (gene / disease / chemical / variant). No LLM routes; the entity
//      profile deterministically selects the engines.
//   2. WHAT each applicable engine says — each is one of the existing deterministic
//      verifiers (genetics, variant pathogenicity, target–disease, safety, bioactivity,
//      PGx), run VERBATIM. Their verdicts are pure functions of real API data.
//   3. The UNIFIED overallVerdict — a PURE, documented function of the component
//      verdicts (see combineVerdicts). NO LLM decides the overall verdict; a claim that
//      overstates ANY axis is flagged `overstated`, all-positive is `supported`, mixed
//      is `partially_supported`, and nothing runnable/found is honestly
//      `insufficient_evidence` rather than a fabricated confident answer.
//
// Every external call is behind an INJECTABLE `deps` object (mirroring
// lib/bio/openTargets.ts) so the whole composer runs OFFLINE against mocked engines in
// the test-suite — no live network, and no engine is invoked for an entity that isn't in
// the claim.

import { annotateText, normalizeEntities } from "./pubtator";
import type { PubtatorDeps } from "./pubtator";
import type { NormalizedEntityGroup } from "./entities.schemas";

import { verifyGeneticAssociation } from "./geneticAssociation";
import type { GeneticDeps } from "./geneticAssociation";
import type { GeneticAssociationResult } from "./genetics.schemas";

import { verifyPathogenicityClaim } from "./variantPathogenicity";
import type { VariantDeps } from "./variantPathogenicity";
import type { PathogenicityVerification } from "./variant.schemas";

import { targetDiseaseEvidence } from "./openTargets";
import type { OpenTargetsDeps } from "./openTargets";
import type { TargetDiseaseEvidence } from "./targets.schemas";

import { assessSafetySignal } from "./pharmacovigilance";
import type { FaersDeps, SafetySignalAssessment } from "./pharmacovigilance";

import { verifyBioactivityClaim } from "./chembl";
import type { ChemblDeps } from "./chembl";
import type { BioactivityVerification } from "./chembl.schemas";

import { verifyPgxClaim } from "./pharmgkb";
import type { PharmGkbDeps } from "./pharmgkb";
import type { PgxVerificationResult } from "./pharmgkb.schemas";

import {
  BiomedicalClaimVerificationSchema,
  type BiomedicalClaimVerification,
  type ClaimEntities,
  type ComponentCheck,
  type OverallVerdict,
} from "./biomedical.schemas";

// ---------------------------------------------------------------------------
// Injectable deps — one field per underlying engine, all optional. A test supplies
// mocks; production leaves them undefined and each engine uses its own live default.
// This is the single side-effecting surface; nothing else here touches the network.
// ---------------------------------------------------------------------------

export interface BiomedicalDeps {
  // Entity extraction (PubTator) — routes which checks apply.
  annotate?: (claim: string) => Promise<NormalizedEntityGroup[]>;
  // The six composed engines. Each mirrors its module's public signature so a mock is a
  // drop-in. Left undefined in production → the real engine with its live default deps.
  geneticAssociation?: typeof verifyGeneticAssociation;
  pathogenicity?: typeof verifyPathogenicityClaim;
  targetDisease?: typeof targetDiseaseEvidence;
  safetySignal?: typeof assessSafetySignal;
  bioactivity?: typeof verifyBioactivityClaim;
  pgx?: typeof verifyPgxClaim;
  // Passthrough deps for the real engines when no mock is supplied.
  pubtatorDeps?: PubtatorDeps;
  geneticDeps?: GeneticDeps;
  variantDeps?: VariantDeps;
  openTargetsDeps?: OpenTargetsDeps;
  faersDeps?: FaersDeps;
  chemblDeps?: ChemblDeps;
  pharmGkbDeps?: PharmGkbDeps;
}

// ---------------------------------------------------------------------------
// Entity extraction — distill PubTator's normalized groups into the plain strings the
// engines consume. We take the FIRST resolved entity of each type (the claim's primary
// mention); its surface text feeds the name-resolving engines, which do their own id
// lookup. Nothing is inferred beyond what PubTator returned.
// ---------------------------------------------------------------------------

// Pull the rsID out of a variant group: prefer a dbSNP-style normalizedId
// ("dbSNP:rs334" → "rs334"), else a mention that already looks like an rsID.
function extractRsId(group: NormalizedEntityGroup): string | null {
  const id = group.normalizedId ?? "";
  const fromId = id.match(/rs\d+/i)?.[0] ?? null;
  if (fromId) return fromId.toLowerCase();
  for (const mention of group.mentions) {
    const m = mention.match(/^rs\d+$/i)?.[0];
    if (m) return m.toLowerCase();
  }
  return null;
}

// The first non-empty surface mention for a group (the primary label to query on).
function primaryMention(group: NormalizedEntityGroup): string | null {
  for (const mention of group.mentions) {
    const t = mention.trim();
    if (t.length > 0) return t;
  }
  return null;
}

export function extractClaimEntities(
  groups: readonly NormalizedEntityGroup[]
): ClaimEntities {
  let gene: string | null = null;
  let disease: string | null = null;
  let chemical: string | null = null;
  let variant: string | null = null;
  let variantRsId: string | null = null;

  for (const group of groups) {
    switch (group.type) {
      case "gene":
        if (gene === null) gene = primaryMention(group);
        break;
      case "disease":
        if (disease === null) disease = primaryMention(group);
        break;
      case "chemical":
        if (chemical === null) chemical = primaryMention(group);
        break;
      case "variant":
        if (variant === null) variant = primaryMention(group);
        if (variantRsId === null) variantRsId = extractRsId(group);
        break;
      // species / anything else: not a routing signal for the composed engines.
      default:
        break;
    }
  }

  return { gene, disease, chemical, variant, variantRsId };
}

// ---------------------------------------------------------------------------
// Component verdict → coarse SIGNAL bucket. This is the SINGLE place each engine's
// verdict vocabulary is mapped onto the four buckets the roll-up reasons over. Keeping it
// centralized and explicit is what makes the overall verdict auditable and deterministic.
//
//   positive   — the evidence supports the claim (confident/at-threshold).
//   overstated — the claim asserts MORE than the data supports (the dangerous direction).
//   negative   — evidence exists but contradicts / falls short of supporting the claim.
//   empty      — an honest not-found / no-association (no evidence either way).
// ---------------------------------------------------------------------------

type Signal = "positive" | "overstated" | "negative" | "empty";

function geneticSignal(verdict: GeneticAssociationResult["verdict"]): Signal {
  switch (verdict) {
    case "genome_wide_significant":
    case "suggestive":
    case "clinvar_pathogenic":
      return "positive";
    case "reported_not_significant":
    case "conflicting":
      return "negative";
    case "no_association_found":
      return "empty";
  }
}

function pathogenicitySignal(verdict: PathogenicityVerification["verdict"]): Signal {
  switch (verdict) {
    case "confirmed":
      return "positive";
    case "overstated_certainty":
      return "overstated";
    case "conflicting":
      return "negative";
    case "not_found":
      return "empty";
  }
}

// Target–disease: Open Targets serves an overall harmonic-sum association score in
// [0,1]. We treat a scored association as positive evidence of a target–disease link;
// no scored association (found:false / null score) is an honest empty. There is no
// "overstated" arm here — the claim being tested is existence-of-association, and the
// engine reports the score verbatim rather than judging a claimed magnitude.
function targetDiseaseSignal(evidence: TargetDiseaseEvidence): Signal {
  return evidence.found && evidence.overallScore !== null ? "positive" : "empty";
}

// Safety signal: a disproportionality `signal:true` (PRR>=2, a>=3, Yates chi2>=4) is a
// real pharmacovigilance flag — positive evidence the drug–event association exists. A
// computed result without a signal is negative (assessed, not flagged); a null result
// (counts couldn't be assembled) is an honest empty.
function safetySignal(result: SafetySignalAssessment | null): Signal {
  if (result === null) return "empty";
  return result.signal ? "positive" : "negative";
}

// Bioactivity: the claim can be overstated on potency OR phase (the dangerous
// directions). Any overstated axis dominates. A confirmed potency/phase or a consistent
// mechanism is positive. An understated axis is negative (claim weaker than reality, not
// dangerous, but not a clean confirmation). Everything not_found/not_claimed is empty.
function bioactivitySignal(v: BioactivityVerification): Signal {
  if (v.potency.verdict === "overstated" || v.phase.verdict === "overstated") {
    return "overstated";
  }
  const positive =
    v.potency.verdict === "confirmed_within_order" ||
    v.phase.verdict === "confirmed" ||
    v.mechanism.verdict === "consistent";
  if (positive) return "positive";
  const negative =
    v.potency.verdict === "understated" ||
    v.phase.verdict === "understated" ||
    v.mechanism.verdict === "unverified";
  return negative ? "negative" : "empty";
}

// PGx: any leveled annotation (high/moderate/preliminary) is positive evidence that the
// gene/variant × drug relationship is documented; not_found is an honest empty. There is
// no "overstated" arm — the engine reports PharmGKB's evidence level verbatim.
function pgxSignal(verdict: PgxVerificationResult["verdict"]): Signal {
  return verdict === "not_found" ? "empty" : "positive";
}

// ---------------------------------------------------------------------------
// Deterministic overall verdict. PURE function of the per-check signals — NO LLM.
//
// Documented rules (precedence, first match wins):
//   1. No check ran at all, or every check that ran is `empty`
//        → insufficient_evidence   (honest "couldn't verify" — never a fabricated call)
//   2. Any `overstated` signal present
//        → overstated              (a claim overstating ANY axis is flagged; dominates)
//   3. At least one `positive` and no `negative`
//        → supported               (every non-empty check confirms the claim)
//   4. At least one `positive` AND at least one `negative`
//        → partially_supported     (the evidence is mixed)
//   5. Otherwise (checks ran, none positive/overstated, at least one `negative`)
//        → unsupported             (evidence exists but contradicts / falls short)
// ---------------------------------------------------------------------------

export function combineVerdicts(
  signals: readonly Signal[]
): { overallVerdict: OverallVerdict; rationale: string } {
  const ran = signals.length;
  const nonEmpty = signals.filter((s) => s !== "empty");

  // Rule 1: nothing runnable, or everything came back empty.
  if (ran === 0 || nonEmpty.length === 0) {
    return {
      overallVerdict: "insufficient_evidence",
      rationale:
        ran === 0
          ? "No biomedical entities in the claim resolved to a runnable evidence check, so there is nothing to verify against the source databases."
          : "Every applicable evidence check returned an honest empty result (no matching record), so the claim can be neither supported nor refuted from these sources.",
    };
  }

  const overstated = signals.filter((s) => s === "overstated").length;
  const positive = signals.filter((s) => s === "positive").length;
  const negative = signals.filter((s) => s === "negative").length;

  // Rule 2: any overstatement dominates (the dangerous direction).
  if (overstated > 0) {
    return {
      overallVerdict: "overstated",
      rationale: `At least one evidence check found the claim asserts more than the source data supports (${overstated} overstated of ${nonEmpty.length} applicable check(s)), so the claim is flagged as overstated.`,
    };
  }

  // Rule 3: all confirming, none contradicting.
  if (positive > 0 && negative === 0) {
    return {
      overallVerdict: "supported",
      rationale: `Every applicable evidence check that returned a result supports the claim (${positive} supporting, no contradicting).`,
    };
  }

  // Rule 4: mixed — some support, some contradict.
  if (positive > 0 && negative > 0) {
    return {
      overallVerdict: "partially_supported",
      rationale: `The evidence is mixed: ${positive} check(s) support the claim and ${negative} contradict or fall short of supporting it.`,
    };
  }

  // Rule 5: evidence exists but none of it confirms the claim.
  return {
    overallVerdict: "unsupported",
    rationale: `Applicable evidence checks ran but none confirmed the claim (${negative} contradicting or below-threshold), so it is unsupported by these sources.`,
  };
}

// ---------------------------------------------------------------------------
// Engine resolution — pick the mock if provided, else the real engine bound to its
// passthrough deps. Keeps the routing block below readable.
// ---------------------------------------------------------------------------

function resolveEngines(deps: BiomedicalDeps) {
  return {
    annotate:
      deps.annotate ??
      (async (claim: string) => {
        const annotations = await annotateText(claim, deps.pubtatorDeps);
        const flat = annotations.flatMap((a) => a.entities);
        return normalizeEntities(flat);
      }),
    geneticAssociation:
      deps.geneticAssociation ??
      ((req: Parameters<typeof verifyGeneticAssociation>[0]) =>
        verifyGeneticAssociation(req, deps.geneticDeps)),
    pathogenicity:
      deps.pathogenicity ??
      ((req: Parameters<typeof verifyPathogenicityClaim>[0]) =>
        verifyPathogenicityClaim(req, deps.variantDeps)),
    targetDisease:
      deps.targetDisease ??
      ((t: string, d: string) => targetDiseaseEvidence(t, d, deps.openTargetsDeps)),
    safetySignal:
      deps.safetySignal ??
      ((drug: string, event: string) => assessSafetySignal(drug, event, deps.faersDeps)),
    bioactivity:
      deps.bioactivity ??
      ((claim: Parameters<typeof verifyBioactivityClaim>[0]) =>
        verifyBioactivityClaim(claim, deps.chemblDeps)),
    pgx:
      deps.pgx ??
      ((req: Parameters<typeof verifyPgxClaim>[0]) => verifyPgxClaim(req, deps.pharmGkbDeps)),
  };
}

// ---------------------------------------------------------------------------
// The composer.
// ---------------------------------------------------------------------------

/**
 * Verify a free-text biomedical claim by composing the deterministic bio engines.
 *
 * ROUTING (entity-driven, deterministic):
 *   gene/variant + disease           → verifyGeneticAssociation
 *   variant (+disease) present       → verifyPathogenicityClaim
 *   drug + disease                   → targetDiseaseEvidence  AND  assessSafetySignal
 *   drug (+ target/potency)          → verifyBioactivityClaim
 *   gene/variant + drug              → verifyPgxClaim
 *
 * Only the checks whose entities are present run, and they run in parallel. The overall
 * verdict is a pure function of their component verdicts (see combineVerdicts). On any
 * engine failure the check is dropped (honest omission) rather than fabricated — a wrong
 * "confident" answer is worse than an honest "couldn't verify."
 */
export async function verifyBiomedicalClaim(
  request: { claim: string },
  deps: BiomedicalDeps = {}
): Promise<BiomedicalClaimVerification> {
  const claim = request.claim.trim();
  const engines = resolveEngines(deps);

  // 1. Extract entities — this decides which engines run.
  const groups = await engines.annotate(claim).catch(() => [] as NormalizedEntityGroup[]);
  const entities = extractClaimEntities(groups);

  const hasGene = entities.gene !== null;
  const hasDisease = entities.disease !== null;
  const hasDrug = entities.chemical !== null;
  const hasVariant = entities.variant !== null || entities.variantRsId !== null;
  const locus = entities.variantRsId ?? entities.variant ?? entities.gene;

  // 2. Build the applicable checks. Each entry is a lazily-run promise producing a
  //    ComponentCheck + its coarse signal, or null if the engine failed/returned nothing
  //    classifiable. Only checks whose entities are present are added.
  const tasks: Array<Promise<{ check: ComponentCheck; signal: Signal } | null>> = [];

  // gene/variant + disease → genetic association.
  if ((hasGene || hasVariant) && hasDisease) {
    tasks.push(
      engines
        .geneticAssociation({
          gene: entities.gene ?? undefined,
          variant: entities.variantRsId ?? entities.variant ?? undefined,
          disease: entities.disease as string,
        })
        .then((res) => ({
          check: {
            kind: "genetic_association" as const,
            verdict: res.verdict,
            summary: res.rationale,
            source: "EBI GWAS Catalog + NCBI ClinVar",
            detail: res,
          },
          signal: geneticSignal(res.verdict),
        }))
        .catch(() => null)
    );
  }

  // variant present → variant pathogenicity (narrowed by disease when available).
  if (hasVariant) {
    tasks.push(
      engines
        .pathogenicity({
          rsId: entities.variantRsId ?? undefined,
          hgvs: entities.variantRsId ? undefined : entities.variant ?? undefined,
          gene: entities.gene ?? undefined,
          condition: entities.disease ?? undefined,
        })
        .then((res) => ({
          check: {
            kind: "variant_pathogenicity" as const,
            verdict: res.verdict,
            summary: res.rationale,
            source: "NCBI ClinVar",
            detail: res,
          },
          signal: pathogenicitySignal(res.verdict),
        }))
        .catch(() => null)
    );
  }

  // drug + disease → target–disease evidence AND safety signal (disease as the event).
  if (hasDrug && hasDisease) {
    tasks.push(
      engines
        .targetDisease(entities.chemical as string, entities.disease as string)
        .then((res) => ({
          check: {
            kind: "target_disease" as const,
            verdict: res.found ? "association_found" : "no_association_found",
            summary: res.found
              ? `Open Targets reports an overall target–disease association score of ${res.overallScore?.toFixed(3)} for this pair.`
              : "Open Targets reports no scored association for this drug/target and disease.",
            source: "Open Targets Platform",
            detail: res,
          },
          signal: targetDiseaseSignal(res),
        }))
        .catch(() => null)
    );

    tasks.push(
      engines
        .safetySignal(entities.chemical as string, entities.disease as string)
        .then((res) => {
          if (res === null) return null; // honest empty — no check surfaced
          return {
            check: {
              kind: "safety_signal" as const,
              verdict: res.signal ? "signal_detected" : "no_signal",
              summary: res.signal
                ? `FAERS disproportionality flags a signal (PRR=${res.prr.toFixed(2)}, a=${res.a}, Yates χ²=${res.chiSquaredYates.toFixed(2)}).`
                : `FAERS disproportionality does not flag a signal (PRR=${res.prr.toFixed(2)}, a=${res.a}).`,
              source: "FDA FAERS (openFDA)",
              detail: res,
            },
            signal: safetySignal(res),
          };
        })
        .catch(() => null)
    );
  }

  // drug present → bioactivity / mechanism (target from a gene entity when present).
  if (hasDrug) {
    tasks.push(
      engines
        .bioactivity({
          drug: entities.chemical as string,
          target: entities.gene ?? undefined,
        })
        .then((res) => ({
          check: {
            kind: "bioactivity" as const,
            verdict: bioactivityVerdictLabel(res),
            summary: res.rationale,
            source: "ChEMBL (EMBL-EBI)",
            detail: res,
          },
          signal: bioactivitySignal(res),
        }))
        .catch(() => null)
    );
  }

  // gene/variant + drug → pharmacogenomics.
  if ((hasGene || hasVariant) && hasDrug) {
    tasks.push(
      engines
        .pgx({
          gene: entities.gene ?? undefined,
          variant: entities.variantRsId ?? entities.variant ?? undefined,
          drug: entities.chemical as string,
        })
        .then((res) => ({
          check: {
            kind: "pharmacogenomics" as const,
            verdict: res.verdict,
            summary: res.rationale,
            source: "PharmGKB / ClinPGx",
            detail: res,
          },
          signal: pgxSignal(res.verdict),
        }))
        .catch(() => null)
    );
  }

  // 3. Run every applicable check in parallel; drop the ones that failed/returned nothing.
  const settled = (await Promise.all(tasks)).filter(
    (r): r is { check: ComponentCheck; signal: Signal } => r !== null
  );

  const checks = settled.map((r) => r.check);
  const signals = settled.map((r) => r.signal);

  // 4. Deterministic roll-up. `locus` referenced only for lint-friendliness of the
  //    routing; the verdict itself derives purely from the component signals.
  void locus;
  const { overallVerdict, rationale } = combineVerdicts(signals);

  const result: BiomedicalClaimVerification = {
    claim,
    entities,
    checks,
    overallVerdict,
    rationale,
  };

  // Defensive: validate the composed shape before it escapes this module.
  return BiomedicalClaimVerificationSchema.parse(result);
}

// A compact label for the bioactivity check's `verdict` field, summarizing the three
// independent axes (potency / phase / mechanism) into one verbatim string. Deterministic.
function bioactivityVerdictLabel(v: BioactivityVerification): string {
  if (v.potency.verdict === "overstated" || v.phase.verdict === "overstated") {
    return "overstated";
  }
  if (
    v.potency.verdict === "confirmed_within_order" ||
    v.phase.verdict === "confirmed" ||
    v.mechanism.verdict === "consistent"
  ) {
    return "confirmed";
  }
  if (
    v.potency.verdict === "understated" ||
    v.phase.verdict === "understated" ||
    v.mechanism.verdict === "unverified"
  ) {
    return "not_confirmed";
  }
  return "not_found";
}

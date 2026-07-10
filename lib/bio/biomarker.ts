// BIOMARKER VALIDATION EVIDENCE — deterministically assemble the evidence for a
// claimed biomarker<->disease (or biomarker<->drug-response) relationship out of the
// bio engines PaperTrail already built.
//
// MOAT: the `validationLevel` is a PURE, documented function of the component
// strengths — NO LLM is anywhere in the numeric/decision path. We compose four
// engines, each already deterministic on real open bio-data:
//   1. genetic association  — verifyGeneticAssociation(biomarker, disease): GWAS
//                             Catalog + ClinVar significance verdict (verbatim).
//   2. target-disease score — targetDiseaseEvidence(gene, disease): Open Targets
//                             genetic_association datatype score, verbatim (only when
//                             the biomarker can be treated as a gene target).
//   3. literature grounding — annotateText(biomarker + disease): did PubTator
//                             normalize BOTH as entities (co-mention)?
//   4. pharmacogenomic      — verifyPgxClaim(biomarker, drug): PharmGKB clinical-
//                             annotation verdict (only when a drug is provided).
//
// We do NOT edit the underlying engines. Every external touchpoint is reached through
// an INJECTABLE `deps` object (mirroring lib/bio/openTargets.ts / repurposing.ts) so
// the whole assembly runs fully OFFLINE in tests against mocked component signals. On
// any component failure we degrade to an HONEST empty signal for that component (never
// a fabricated value) and decide the level on what could be assembled.
//
// The OPTIONAL `summarizeBiomarker()` (callClaudeForJson + Zod) writes prose OVER the
// already-assembled evidence only; the level stays deterministic and is the source of
// truth.

import { callClaudeForJson } from "../claude";
import {
  verifyGeneticAssociation,
  type GeneticDeps,
} from "./geneticAssociation";
import { targetDiseaseEvidence, type OpenTargetsDeps } from "./openTargets";
import { annotateText, type PubtatorDeps } from "./pubtator";
import { verifyPgxClaim, type PharmGkbDeps } from "./pharmgkb";
import type { GeneticAssociationResult } from "./genetics.schemas";
import type { PgxVerificationResult } from "./pharmgkb.schemas";
import type { PmidAnnotation } from "./entities.schemas";
import type { TargetDiseaseEvidence } from "./targets.schemas";
import {
  BiomarkerSummarySchema,
  BiomarkerValidationSchema,
  type BiomarkerEvidence,
  type BiomarkerGeneticStrength,
  type BiomarkerSummary,
  type BiomarkerValidation,
  type BiomarkerValidationLevel,
  type GeneticEvidence,
  type LiteratureEvidence,
  type LiteratureStrength,
  type PharmacogenomicEvidence,
  type TargetScoreEvidence,
} from "./biomarker.schemas";

// ---------------------------------------------------------------------------
// Documented deterministic thresholds (fixed constants — NOT tuned to any example)
// ---------------------------------------------------------------------------

// An Open Targets genetic_association datatype score at/above this counts as a STRONG
// gene-level genetic signal — a substitute for a genome-wide GWAS hit when the biomarker
// resolves as a gene target. 0.5 is the mid-point of the [0,1] harmonic-sum genetic
// channel; Open Targets treats a genetic score in this range as substantial aggregated
// human-genetic support. Not example-fit.
const STRONG_TARGET_GENETIC_SCORE = 0.5;

// A PGx evidence level at or above this rank counts as a STRONG drug-response signal.
// PharmGKB levels 1A/1B are the high-confidence, guideline-backed tier.
const STRONG_PGX_LEVELS = new Set(["1A", "1B"]);

// ---------------------------------------------------------------------------
// Injectable dependencies — every external engine call goes through here so the
// assembly is fully offline-testable. Defaults wire the real engines.
// ---------------------------------------------------------------------------

export interface BiomarkerDeps {
  // GWAS Catalog + ClinVar genetic-association verdict for biomarker<->disease.
  verifyGeneticAssociation: typeof verifyGeneticAssociation;
  geneticDeps?: GeneticDeps;
  // Open Targets target<->disease genetic score (biomarker treated as a gene target).
  targetDiseaseEvidence: typeof targetDiseaseEvidence;
  openTargetsDeps?: OpenTargetsDeps;
  // PubTator on-the-fly entity normalization for literature-grounding co-mention.
  annotateText: typeof annotateText;
  pubtatorDeps?: PubtatorDeps;
  // PharmGKB clinical-annotation verdict for biomarker<->drug-response (when drug set).
  verifyPgxClaim: typeof verifyPgxClaim;
  pharmgkbDeps?: PharmGkbDeps;
}

const defaultDeps: BiomarkerDeps = {
  verifyGeneticAssociation,
  targetDiseaseEvidence,
  annotateText,
  verifyPgxClaim,
};

// ---------------------------------------------------------------------------
// Component assembly — each returns an HONEST empty signal on failure
// ---------------------------------------------------------------------------

// Map the deterministic genetic verdict onto our biomarker strength band. Pure lookup;
// an unknown verdict (should not happen) degrades to "none" rather than a fabrication.
const GENETIC_VERDICT_TO_STRENGTH: Record<string, BiomarkerGeneticStrength> = {
  genome_wide_significant: "genome_wide",
  suggestive: "suggestive",
  clinvar_pathogenic: "clinvar_pathogenic",
  conflicting: "conflicting",
  reported_not_significant: "reported",
  no_association_found: "none",
};

function geneticStrength(verdict: string | null): BiomarkerGeneticStrength {
  if (!verdict) return "none";
  return GENETIC_VERDICT_TO_STRENGTH[verdict] ?? "none";
}

async function assembleGenetic(
  biomarker: string,
  disease: string,
  deps: BiomarkerDeps
): Promise<GeneticEvidence> {
  const empty: GeneticEvidence = {
    assessed: false,
    verdict: null,
    strength: "none",
    minPValue: null,
  };
  try {
    // The biomarker is passed as BOTH a gene and a variant key; the genetics engine
    // uses whichever the databases recognize (rsID -> GWAS SNP endpoint / ClinVar
    // variant; gene symbol -> gene endpoints). We don't pre-classify the biomarker.
    const result: GeneticAssociationResult = await deps.verifyGeneticAssociation(
      { gene: biomarker, variant: biomarker, disease },
      deps.geneticDeps
    );
    return {
      assessed: true,
      verdict: result.verdict,
      strength: geneticStrength(result.verdict),
      minPValue: result.minPValue,
    };
  } catch {
    return empty;
  }
}

async function assembleTargetScore(
  biomarker: string,
  disease: string,
  deps: BiomarkerDeps
): Promise<TargetScoreEvidence> {
  const empty: TargetScoreEvidence = {
    assessed: false,
    associationFound: false,
    overallScore: null,
    geneticScore: null,
  };
  try {
    // Treat the biomarker as a gene symbol; Open Targets resolves it (or honestly
    // returns found:false when it isn't a gene it recognizes). We never fabricate a
    // score — an unresolved biomarker simply yields no target-score evidence.
    const ev: TargetDiseaseEvidence = await deps.targetDiseaseEvidence(
      biomarker,
      disease,
      deps.openTargetsDeps
    );
    return {
      assessed: true,
      associationFound: ev.found,
      overallScore: ev.overallScore,
      geneticScore: ev.datatypeScores.genetic_association,
    };
  } catch {
    return empty;
  }
}

// Does a normalized-entity list from PubTator ground a query string? We match a mention
// (case-insensitive substring, either direction) among the entities of the given types.
// PubTator surface forms and the raw query rarely match exactly ("BRCA1" vs "BRCA1 gene",
// "breast cancer" vs "breast carcinoma"), so substring matching is deliberate but still
// requires an ACTUAL normalized entity to exist — we never ground on the query alone.
function mentionMatches(query: string, mention: string): boolean {
  const q = query.trim().toLowerCase();
  const m = mention.trim().toLowerCase();
  if (q.length === 0 || m.length === 0) return false;
  return q.includes(m) || m.includes(q);
}

const BIOMARKER_ENTITY_TYPES = new Set(["gene", "variant", "chemical"]);
const DISEASE_ENTITY_TYPES = new Set(["disease"]);

function grounded(
  annotations: PmidAnnotation[],
  query: string,
  allowedTypes: Set<string>
): boolean {
  for (const doc of annotations) {
    for (const entity of doc.entities) {
      if (!allowedTypes.has(entity.type)) continue;
      if (mentionMatches(query, entity.text)) return true;
    }
  }
  return false;
}

function literatureStrength(
  biomarkerGrounded: boolean,
  diseaseGrounded: boolean
): LiteratureStrength {
  if (biomarkerGrounded && diseaseGrounded) return "co_mention";
  if (biomarkerGrounded || diseaseGrounded) return "partial";
  return "none";
}

async function assembleLiterature(
  biomarker: string,
  disease: string,
  deps: BiomarkerDeps
): Promise<LiteratureEvidence> {
  const empty: LiteratureEvidence = {
    assessed: false,
    biomarkerGrounded: false,
    diseaseGrounded: false,
    strength: "none",
  };
  try {
    // Submit a compact passage naming both entities and let PubTator normalize it.
    // Co-mention of BOTH normalized entities is the deterministic grounding signal —
    // it is not the LLM deciding relevance, it's PubTator resolving real entities.
    const text = `${biomarker} and ${disease}.`;
    const annotations = await deps.annotateText(text, deps.pubtatorDeps);
    if (annotations.length === 0) return empty;

    const biomarkerGrounded = grounded(
      annotations,
      biomarker,
      BIOMARKER_ENTITY_TYPES
    );
    const diseaseGrounded = grounded(annotations, disease, DISEASE_ENTITY_TYPES);
    return {
      assessed: true,
      biomarkerGrounded,
      diseaseGrounded,
      strength: literatureStrength(biomarkerGrounded, diseaseGrounded),
    };
  } catch {
    return empty;
  }
}

async function assemblePharmacogenomic(
  biomarker: string,
  disease: string,
  drug: string | null,
  deps: BiomarkerDeps
): Promise<PharmacogenomicEvidence> {
  const empty: PharmacogenomicEvidence = {
    assessed: false,
    verdict: null,
    strongestEvidenceLevel: null,
    attribution: null,
  };
  // Pharmacogenomics is drug-response context — only assembled when a drug is given.
  if (!drug) return empty;
  try {
    // Biomarker passed as both gene and variant; disease is echoed as the claimed
    // effect for the PGx engine's audit trail (it never changes the PGx verdict).
    const result: PgxVerificationResult = await deps.verifyPgxClaim(
      { gene: biomarker, variant: biomarker, drug, claimedEffect: disease },
      deps.pharmgkbDeps
    );
    return {
      assessed: true,
      verdict: result.verdict,
      strongestEvidenceLevel: result.strongestEvidenceLevel,
      attribution: result.attribution ?? null,
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Deterministic validation level
// ---------------------------------------------------------------------------

// Genetic strengths that count as STRONG, field-standard genetic support.
const STRONG_GENETIC = new Set<BiomarkerGeneticStrength>([
  "genome_wide",
  "clinvar_pathogenic",
]);

// Genetic strengths that count as a REAL-but-not-definitive genetic signal.
const MODERATE_GENETIC = new Set<BiomarkerGeneticStrength>(["suggestive"]);

// Genetic strengths that count as only a SOFT/soft-negative signal (some smoke).
const SOFT_GENETIC = new Set<BiomarkerGeneticStrength>([
  "reported",
  "conflicting",
]);

/**
 * Derive the biomarker validationLevel DETERMINISTICALLY from the assembled component
 * strengths. Pure function — same evidence, same level, no randomness, no LLM.
 *
 * Rules (documented, evaluated in precedence order):
 *   analytically_grounded — STRONG genetic support (genome-wide GWAS or ClinVar
 *                           pathogenic, OR an Open Targets genetic score
 *                           >= STRONG_TARGET_GENETIC_SCORE) AND literature co-mention.
 *                           Field-standard genetic grounding, independently corroborated
 *                           in the literature.
 *   emerging              — a real signal that isn't fully corroborated:
 *                             • STRONG genetic support WITHOUT literature co-mention, OR
 *                             • a suggestive genetic signal WITH literature co-mention, OR
 *                             • a strong (1A/1B) PGx drug-response annotation.
 *   weak                  — only a soft signal: literature co-mention alone, a
 *                           suggestive genetic signal alone, a reported-not-significant
 *                           or conflicting genetic picture, or any PGx annotation found.
 *   unsupported           — no disease-matched genetic, target, literature, or PGx
 *                           evidence assembled (honest empty).
 */
export function deriveValidationLevel(evidence: BiomarkerEvidence): {
  validationLevel: BiomarkerValidationLevel;
  rationale: string;
} {
  const { genetic, targetScore, literature, pharmacogenomic } = evidence;

  const strongGeneticFromGwas = STRONG_GENETIC.has(genetic.strength);
  const strongGeneticFromTarget =
    targetScore.geneticScore !== null &&
    targetScore.geneticScore >= STRONG_TARGET_GENETIC_SCORE;
  const strongGenetic = strongGeneticFromGwas || strongGeneticFromTarget;

  const suggestiveGenetic = MODERATE_GENETIC.has(genetic.strength);
  const softGenetic = SOFT_GENETIC.has(genetic.strength);

  const coMention = literature.strength === "co_mention";

  const strongPgx =
    pharmacogenomic.assessed &&
    pharmacogenomic.strongestEvidenceLevel !== null &&
    STRONG_PGX_LEVELS.has(pharmacogenomic.strongestEvidenceLevel);
  const anyPgx =
    pharmacogenomic.assessed && pharmacogenomic.verdict !== null &&
    pharmacogenomic.verdict !== "not_found";

  // 1. analytically_grounded — strong genetic support corroborated by co-mention.
  if (strongGenetic && coMention) {
    const src = strongGeneticFromGwas
      ? `a ${genetic.strength.replace("_", "-")} genetic association`
      : `an Open Targets genetic score of ${targetScore.geneticScore?.toFixed(2)}`;
    return {
      validationLevel: "analytically_grounded",
      rationale:
        `Strong genetic support (${src}) is corroborated by PubTator literature ` +
        `co-mention of the biomarker and disease. The relationship is grounded in ` +
        `field-standard genetic evidence and independently mentioned in the literature.`,
    };
  }

  // 2. emerging — a real signal that isn't fully corroborated.
  if (strongGenetic) {
    return {
      validationLevel: "emerging",
      rationale:
        "Strong genetic support was found, but without independent PubTator " +
        "literature co-mention of the biomarker and disease to corroborate it.",
    };
  }
  if (suggestiveGenetic && coMention) {
    return {
      validationLevel: "emerging",
      rationale:
        "A suggestive (not genome-wide) genetic association is accompanied by " +
        "PubTator literature co-mention of the biomarker and disease.",
    };
  }
  if (strongPgx) {
    return {
      validationLevel: "emerging",
      rationale:
        "A high-confidence (level 1A/1B) PharmGKB pharmacogenomic annotation supports " +
        "the biomarker as a drug-response marker, without genome-wide disease-genetic support.",
    };
  }

  // 3. weak — only a soft signal.
  if (coMention || suggestiveGenetic || softGenetic || anyPgx) {
    const bits: string[] = [];
    if (suggestiveGenetic) bits.push("a suggestive genetic signal");
    if (softGenetic)
      bits.push(
        genetic.strength === "conflicting"
          ? "a conflicting ClinVar interpretation"
          : "a reported-but-not-significant genetic association"
      );
    if (coMention) bits.push("literature co-mention");
    if (anyPgx) bits.push("a lower-tier pharmacogenomic annotation");
    return {
      validationLevel: "weak",
      rationale:
        `Only a soft signal was assembled (${bits.join(", ")}); no strong, ` +
        `corroborated genetic evidence for the biomarker-disease relationship.`,
    };
  }

  // 4. unsupported — honest empty.
  return {
    validationLevel: "unsupported",
    rationale:
      "No disease-matched genetic, target-association, literature, or pharmacogenomic " +
      "evidence was found for this biomarker-disease relationship.",
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Validate a claimed biomarker<->disease (optionally biomarker<->drug-response)
 * relationship by DETERMINISTICALLY assembling evidence from the four bio engines and
 * deriving a validationLevel from the documented component-strength rules. Each engine
 * is queried independently; a failing engine degrades to an honest empty component
 * (never a fabricated value) rather than sinking the others. The result is Zod-validated
 * before it escapes this module. No LLM is in the decision path.
 */
export async function validateBiomarker(
  request: { biomarker: string; disease: string; drug?: string },
  deps: BiomarkerDeps = defaultDeps
): Promise<BiomarkerValidation> {
  const biomarker = request.biomarker.trim();
  const disease = request.disease.trim();
  const drug = request.drug?.trim() || null;

  const [genetic, targetScore, literature, pharmacogenomic] = await Promise.all([
    assembleGenetic(biomarker, disease, deps),
    assembleTargetScore(biomarker, disease, deps),
    assembleLiterature(biomarker, disease, deps),
    assemblePharmacogenomic(biomarker, disease, drug, deps),
  ]);

  const evidence: BiomarkerEvidence = {
    genetic,
    targetScore,
    literature,
    pharmacogenomic,
  };
  const { validationLevel, rationale } = deriveValidationLevel(evidence);

  return BiomarkerValidationSchema.parse({
    biomarker,
    disease,
    drug,
    evidence,
    validationLevel,
    rationale,
  });
}

// ---------------------------------------------------------------------------
// summarizeBiomarker — OPTIONAL, additive Claude layer. It writes plain-language prose
// ABOUT the deterministic evidence. The validationLevel stays from deriveValidationLevel;
// the summary must only reference assembled data, and is Zod-validated before use.
// ---------------------------------------------------------------------------

// Compact, deterministic serialization of the assembled evidence for the prompt. We
// hand the model ONLY the assembled component signals + the deterministic level so it
// cannot reference anything not in the data.
function evidenceForPrompt(v: BiomarkerValidation): string {
  const e = v.evidence;
  const p = (b: boolean) => (b ? "yes" : "no");
  return [
    `Biomarker: ${v.biomarker}`,
    `Disease: ${v.disease}`,
    `Drug (drug-response context): ${v.drug ?? "none"}`,
    `Deterministic validation level: ${v.validationLevel}`,
    "",
    `Genetic (GWAS/ClinVar): assessed=${p(e.genetic.assessed)}, verdict=${
      e.genetic.verdict ?? "none"
    }, strength=${e.genetic.strength}, minPValue=${
      e.genetic.minPValue === null ? "none" : e.genetic.minPValue.toExponential(2)
    }`,
    `Target-disease genetic score (Open Targets): assessed=${p(
      e.targetScore.assessed
    )}, associationFound=${p(e.targetScore.associationFound)}, geneticScore=${
      e.targetScore.geneticScore === null
        ? "none"
        : e.targetScore.geneticScore.toFixed(3)
    }`,
    `Literature (PubTator co-mention): strength=${e.literature.strength}, ` +
      `biomarkerGrounded=${p(e.literature.biomarkerGrounded)}, diseaseGrounded=${p(
        e.literature.diseaseGrounded
      )}`,
    `Pharmacogenomic (PharmGKB): assessed=${p(
      e.pharmacogenomic.assessed
    )}, verdict=${e.pharmacogenomic.verdict ?? "none"}, strongestLevel=${
      e.pharmacogenomic.strongestEvidenceLevel ?? "none"
    }`,
  ].join("\n");
}

const SUMMARY_SYSTEM = [
  "You summarize BIOMARKER VALIDATION EVIDENCE for a translational-research audience.",
  "You are given a DETERMINISTIC validation level and the assembled component signals",
  "VERBATIM. Do NOT invent, recompute, or restate any value not in the provided data,",
  "and do NOT claim evidence for a component shown as not assessed or 'none'. Reference",
  "only the biomarker, disease, drug, level, and component signals provided.",
  "",
  "The validation level is analytically_grounded > emerging > weak > unsupported.",
  "",
  "Return ONLY a JSON object with exactly these keys:",
  '  "summary": a 2-4 sentence plain-language description of how well the biomarker-',
  "             disease relationship is validated and which evidence drives the level.",
  '  "keyEvidence": one of "genetic" | "target_score" | "literature" |',
  '             "pharmacogenomic" | null — the single most decisive assembled component,',
  "             or null if nothing was assembled.",
].join("\n");

/**
 * OPTIONAL plain-language summary of a deterministic biomarker validation. Calls Claude
 * and validates the result against BiomarkerSummarySchema. Strictly additive: the
 * validationLevel in `validation` is unchanged and remains the source of truth. Callers
 * that want no LLM simply never call this.
 *
 * Throws if Claude returns non-JSON or fails validation — the caller decides whether to
 * surface the level without a summary (they always can).
 */
export async function summarizeBiomarker(
  validation: BiomarkerValidation,
  callJson: typeof callClaudeForJson = callClaudeForJson
): Promise<BiomarkerSummary> {
  return callJson({
    system: SUMMARY_SYSTEM,
    user: evidenceForPrompt(validation),
    schema: BiomarkerSummarySchema,
    maxTokens: 512,
  });
}

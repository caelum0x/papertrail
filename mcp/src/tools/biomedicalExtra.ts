// Biomedical evidence tools — EXTRA engines (part 2 of the biomedical group).
//
// Companion to biomedicalCore.ts. Same pattern: thin, typed, read-only wrappers
// over deterministic PaperTrail /api/bio endpoints. This file holds the
// drug/mechanism and composite engines: unified claim verification, bioactivity,
// pharmacogenomics, drug–drug interaction, repurposing, and biomarker validation.

import { z } from "zod";
import type { PaperTrailClient } from "../client.js";
import { tool, formatResult, toErrorMessage } from "../registry.js";
import type { PaperTrailTool } from "../registry.js";

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

// Validate args, POST body to a fixed path, format the reply.
function postHandler(
  path: string,
  shape: z.ZodRawShape,
  summarize: (data: unknown) => string
) {
  const schema = z.object(shape);
  return async (
    args: Record<string, unknown>,
    client: PaperTrailClient
  ): Promise<string> => {
    try {
      const body = schema.parse(args);
      const data = await client.post<unknown>(path, body);
      return formatResult(summarize(data), data);
    } catch (err) {
      return toErrorMessage(err);
    }
  };
}

// For the composite engines that accept ?summarize=true: split the summarize flag
// out of the body and toggle the query string.
function summarizableHandler(
  basePath: string,
  shape: z.ZodRawShape,
  summarize: (data: unknown) => string
) {
  const schema = z.object({ ...shape, summarize: z.boolean().optional() });
  return async (
    args: Record<string, unknown>,
    client: PaperTrailClient
  ): Promise<string> => {
    try {
      const parsed = schema.parse(args);
      const { summarize: wantSummary, ...body } = parsed as Record<string, unknown> & {
        summarize?: boolean;
      };
      const path = wantSummary ? `${basePath}?summarize=true` : basePath;
      const data = await client.post<unknown>(path, body);
      return formatResult(summarize(data), data);
    } catch (err) {
      return toErrorMessage(err);
    }
  };
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

// ── bio_verify_claim ───────────────────────────────────────────────────────
// The capstone: one free-text claim → routed → unified deterministic verdict.
const bioVerifyClaim = tool({
  name: "bio_verify_claim",
  title: "Unified Biomedical Claim Verifier",
  description:
    "Verify a free-text biomedical claim end-to-end and return ONE unified verdict. Provide `claim` " +
    "(e.g. \"PCSK9 loss-of-function protects against coronary artery disease\"). The engine extracts " +
    "the claim's entities with PubTator to ROUTE which checks apply, runs only the relevant " +
    "deterministic engines in parallel (genetics, variant pathogenicity, target–disease, safety, " +
    "bioactivity, pharmacogenomics), and composes their component verdicts into an overall verdict " +
    "with a rationale and the per-check breakdown. The overall verdict is a PURE deterministic " +
    "function of the components — no LLM is in the decision path. A claim with no runnable entity " +
    "returns insufficient_evidence rather than a fabricated confident answer. USE THIS as the default, " +
    "one-shot entry point when you have a biomedical assertion and want the strongest available check " +
    "without deciding which engine to call.",
  inputSchema: {
    claim: z
      .string()
      .min(3)
      .max(2_000)
      .describe("The biomedical claim sentence to verify."),
  },
  annotations: READ_ONLY,
  handler: postHandler("/api/bio/verify-claim", {
    claim: z.string().min(3).max(2_000),
  }, (data) => {
    const d = asRecord(data);
    const checks = Array.isArray(d.checks) ? d.checks.length : 0;
    return `Overall verdict: ${String(d.overallVerdict ?? "unknown")} across ${checks} check(s).`;
  }),
});

// ── bio_bioactivity ────────────────────────────────────────────────────────
const bioBioactivity = tool({
  name: "bio_bioactivity",
  title: "Drug–Target Bioactivity / Mechanism (ChEMBL)",
  description:
    "Verify a drug's potency, clinical phase, and mechanism against measured ChEMBL bioactivities. " +
    "Provide `drug` (required) and any of `target`, `claimedPotencyNM` (claimed potency in nanomolar), " +
    "`claimedMechanism`, and `claimedPhase` (0–4). Resolves the drug to its ChEMBL id, fetches " +
    "IC50/Ki/Kd/EC50 measurements, and returns deterministic verdicts: potency " +
    "confirmed_within_order / overstated / understated / not_found (order-of-magnitude band on nM), " +
    "phase confirmed / overstated / understated / not_found (claimed vs ChEMBL max_phase), and a " +
    "mechanism-consistency check — with the supporting activity records. No LLM in the loop; " +
    "unresolved drugs degrade to honest not_found. Results carry a ChEMBL CC BY-SA 3.0 attribution. " +
    "USE THIS to fact-check a stated drug potency, development stage, or mechanism.",
  inputSchema: {
    drug: z.string().min(1).max(200).describe("Drug name (required)."),
    target: z.string().min(1).max(200).optional().describe("Target gene/protein to scope activities."),
    claimedPotencyNM: z
      .number()
      .positive()
      .finite()
      .optional()
      .describe("Claimed potency in nanomolar (nM) to compare against measured values."),
    claimedMechanism: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe("Claimed mechanism of action to check for consistency."),
    claimedPhase: z
      .number()
      .int()
      .min(0)
      .max(4)
      .optional()
      .describe("Claimed max clinical phase (0–4) to compare against ChEMBL."),
  },
  annotations: READ_ONLY,
  handler: postHandler("/api/bio/bioactivity", {
    drug: z.string().min(1).max(200),
    target: z.string().min(1).max(200).optional(),
    claimedPotencyNM: z.number().positive().finite().optional(),
    claimedMechanism: z.string().min(1).max(300).optional(),
    claimedPhase: z.number().int().min(0).max(4).optional(),
  }, (data) => {
    const d = asRecord(data);
    const potency = asRecord(d.potency).verdict;
    const phase = asRecord(d.phase).verdict;
    const mech = asRecord(d.mechanism).verdict;
    return `Potency: ${String(potency ?? "n/a")} · Phase: ${String(phase ?? "n/a")} · Mechanism: ${String(
      mech ?? "n/a"
    )}.`;
  }),
});

// ── bio_pharmacogenomics ───────────────────────────────────────────────────
const bioPharmacogenomics = tool({
  name: "bio_pharmacogenomics",
  title: "Pharmacogenomic Annotation Verification (PharmGKB)",
  description:
    "Verify a gene/variant–drug pharmacogenomic annotation against PharmGKB / ClinPGx. Provide `drug` " +
    "(required) plus an optional `gene` or `variant` (e.g. gene=\"CYP2C19\", variant=\"*2\") and an " +
    "optional `claimedEffect` to check. Returns a deterministic verdict — high_confidence (PharmGKB " +
    "evidence level 1A/1B), moderate (2A/2B), preliminary (3/4), or not_found — with the strongest " +
    "matching clinical annotation and the supporting records. The verdict follows PharmGKB's documented " +
    "evidence-level ordering; no LLM is involved, and an empty response yields honest not_found. Returned " +
    "content is PharmGKB / ClinPGx data (CC BY-SA 4.0; a share-alike attribution is included). USE THIS " +
    "to check whether a gene-guided-dosing or drug-response claim is backed by graded clinical evidence.",
  inputSchema: {
    drug: z.string().min(1).max(200).describe("Drug name (required)."),
    gene: z.string().min(1).max(64).optional().describe("Gene symbol, e.g. CYP2C19."),
    variant: z.string().min(1).max(64).optional().describe("Variant / star allele, e.g. *2 or rs4244285."),
    claimedEffect: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe("The pharmacogenomic effect being claimed, to check against annotations."),
  },
  annotations: READ_ONLY,
  handler: postHandler("/api/bio/pharmacogenomics", {
    drug: z.string().min(1).max(200),
    gene: z.string().min(1).max(64).optional(),
    variant: z.string().min(1).max(64).optional(),
    claimedEffect: z.string().min(1).max(500).optional(),
  }, (data) => {
    const d = asRecord(data);
    const annotations = Array.isArray(d.annotations) ? d.annotations.length : 0;
    return `Verdict: ${String(d.verdict ?? "unknown")} · strongest level ${String(
      d.strongestEvidenceLevel ?? "n/a"
    )} (${annotations} annotation(s)).`;
  }),
});

// ── bio_drug_interaction ───────────────────────────────────────────────────
const bioDrugInteraction = tool({
  name: "bio_drug_interaction",
  title: "Drug–Drug Interaction Signal (FAERS)",
  description:
    "Screen for a drug–drug-interaction signal from FDA FAERS spontaneous reports. Provide `drugA`, " +
    "`drugB`, and `event` (e.g. drugA=\"warfarin\", drugB=\"fluconazole\", event=\"haemorrhage\"). " +
    "Assembles disproportionality (PRR / ROR / chi² / Information Component) for the event among reports " +
    "listing BOTH drugs, contrasts it against each single-drug signal, and returns a deterministic " +
    "verdict: synergistic_signal, no_excess, or insufficient_data. No LLM is in the numeric path — every " +
    "number is a closed-form statistic over open report counts. This is a hypothesis-generating screen, " +
    "NOT proof of a causal interaction; upstream gaps return honest-null blocks with insufficient_data. " +
    "USE THIS to check whether co-reporting of two drugs is disproportionately linked to an adverse event.",
  inputSchema: {
    drugA: z.string().min(1).max(200).describe("First drug name."),
    drugB: z.string().min(1).max(200).describe("Second drug name."),
    event: z.string().min(1).max(200).describe("Adverse event term to screen for."),
  },
  annotations: READ_ONLY,
  handler: postHandler("/api/bio/drug-interaction", {
    drugA: z.string().min(1).max(200),
    drugB: z.string().min(1).max(200),
    event: z.string().min(1).max(200),
  }, (data) => {
    const d = asRecord(data);
    return `Interaction verdict: ${String(d.interaction ?? "unknown")}.`;
  }),
});

// ── bio_repurposing ────────────────────────────────────────────────────────
const bioRepurposing = tool({
  name: "bio_repurposing",
  title: "Drug Repurposing Evidence Bundle",
  description:
    "Assemble a deterministic drug-repurposing evidence bundle for a proposed drug↔indication link. " +
    "Provide `drug` and `indication` (e.g. drug=\"metformin\", indication=\"colorectal cancer\"). " +
    "Combines four engines — Open Targets (genetic target↔indication association), ChEMBL (max clinical " +
    "phase + target bioactivity), ClinicalTrials.gov (existing trials, including failures), and FAERS " +
    "(pharmacovigilance) — into a composite score in [0,1] and a verdict: strong_rationale, plausible, " +
    "weak, or discouraged. No LLM is in the numeric path. Set `summarize` to true to add a Claude " +
    "plain-language summary that references only the assembled evidence (it never changes a number). " +
    "USE THIS to gauge whether repurposing an existing drug for a new indication is scientifically " +
    "supported before deeper investigation.",
  inputSchema: {
    drug: z.string().min(1).max(200).describe("Existing drug to repurpose."),
    indication: z.string().min(1).max(200).describe("Proposed new indication."),
    summarize: z
      .boolean()
      .optional()
      .describe("If true, append a Claude plain-language summary of the deterministic bundle."),
  },
  annotations: READ_ONLY,
  handler: summarizableHandler("/api/bio/repurposing", {
    drug: z.string().min(1).max(200),
    indication: z.string().min(1).max(200),
  }, (data) => {
    const d = asRecord(data);
    return `Verdict: ${String(d.verdict ?? "unknown")} · composite score ${String(d.score ?? "n/a")}.`;
  }),
});

// ── bio_biomarker ──────────────────────────────────────────────────────────
const bioBiomarker = tool({
  name: "bio_biomarker",
  title: "Biomarker Validation Evidence",
  description:
    "Assemble deterministic validation evidence for a claimed biomarker↔disease (or biomarker↔drug-" +
    "response) relationship. Provide `biomarker` and `disease`, optionally `drug` (e.g. " +
    "biomarker=\"CYP2C19*2\", disease=\"clopidogrel resistance\", drug=\"clopidogrel\"). Combines four " +
    "engines — genetic association (GWAS Catalog + ClinVar), target-disease genetic score (Open Targets), " +
    "literature grounding (PubTator co-mention), and pharmacogenomic context (PharmGKB) — into a " +
    "deterministic validationLevel: analytically_grounded, emerging, weak, or unsupported, with the " +
    "assembled evidence and a rationale. No LLM is in the decision path. Set `summarize` to true for a " +
    "Claude plain-language summary (references only the assembled evidence). USE THIS to judge how well a " +
    "candidate biomarker is validated for a disease or drug-response endpoint.",
  inputSchema: {
    biomarker: z.string().min(1).max(100).describe("Biomarker, e.g. BRCA1 or CYP2C19*2."),
    disease: z.string().min(2).max(200).describe("Disease or drug-response endpoint."),
    drug: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Optional drug context for a biomarker↔drug-response claim."),
    summarize: z
      .boolean()
      .optional()
      .describe("If true, append a Claude plain-language summary of the deterministic validation."),
  },
  annotations: READ_ONLY,
  handler: summarizableHandler("/api/bio/biomarker", {
    biomarker: z.string().min(1).max(100),
    disease: z.string().min(2).max(200),
    drug: z.string().min(1).max(200).optional(),
  }, (data) => {
    const d = asRecord(data);
    return `Validation level: ${String(d.validationLevel ?? "unknown")}.`;
  }),
});

export const biomedicalExtraTools: PaperTrailTool[] = [
  bioVerifyClaim,
  bioBioactivity,
  bioPharmacogenomics,
  bioDrugInteraction,
  bioRepurposing,
  bioBiomarker,
];

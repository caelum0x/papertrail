import { z } from "zod";

// Zod schemas for the UNIFIED BIOMEDICAL CLAIM VERIFIER — the capstone that composes
// the individual bio engines (genetics, variant pathogenicity, target–disease evidence,
// pharmacovigilance, ChEMBL bioactivity, PharmGKB PGx) into ONE deterministic verdict.
//
// Two roles, mirroring the other bio.*.schemas.ts files:
//   1. Validate the PUBLIC request body at the API boundary (never trust raw JSON).
//   2. Give the composer typed, normalized shapes so the overall-verdict logic never
//      has to defend against a malformed component result.
//
// No LLM decides anything here. The `overallVerdict` is a PURE function of the component
// verdicts (see verifyBiomedicalClaim.ts for the documented rules). Claude, if ever
// added, is summary-only and never touches these fields.

// --- Public request ------------------------------------------------------------

// A biomedical claim is a single free-text sentence (e.g. "PCSK9 loss-of-function
// variants protect against coronary artery disease" or "Drug X is a 5 nM inhibitor of
// BRAF"). The verifier extracts entities from it (PubTator) to route which checks run.
// Length-capped so a caller can't submit an unbounded document; the route additionally
// never logs the claim text.
export const BiomedicalClaimRequestSchema = z.object({
  claim: z.string().trim().min(3, "claim is required").max(2_000),
});

export type BiomedicalClaimRequest = z.infer<typeof BiomedicalClaimRequestSchema>;

// --- Extracted entities (what PubTator resolved, distilled for routing) --------

// The kinds of check the composer can run, keyed by the entity combination present in
// the claim. This vocabulary is the ROUTING surface: each `kind` corresponds to exactly
// one underlying engine.
export const CHECK_KINDS = [
  "genetic_association",
  "variant_pathogenicity",
  "target_disease",
  "safety_signal",
  "bioactivity",
  "pharmacogenomics",
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export const CheckKindSchema = z.enum(CHECK_KINDS);

// The entities extracted from the claim, distilled from PubTator's normalized groups
// into the plain strings the engines consume. Each is nullable: PubTator may resolve a
// gene but no disease, etc. `variantRsId` is the dbSNP rsID when one was recognized.
// These are the ONLY things that drive routing — nothing is inferred beyond what
// PubTator actually returned.
export const ClaimEntitiesSchema = z.object({
  gene: z.string().nullable(),
  disease: z.string().nullable(),
  chemical: z.string().nullable(),
  variant: z.string().nullable(),
  variantRsId: z.string().nullable(),
});

export type ClaimEntities = z.infer<typeof ClaimEntitiesSchema>;

// --- Per-check result ----------------------------------------------------------

// One composed check: which engine ran (`kind`), the engine's own verdict string
// (`verdict`, verbatim — e.g. "genome_wide_significant", "overstated"), a short
// human-readable `summary` (the engine's own rationale, never an LLM's), and the
// `source` database that verdict rests on. The full component result is carried under
// `detail` for auditability (the exact records the engine returned).
export const ComponentCheckSchema = z.object({
  kind: CheckKindSchema,
  verdict: z.string(),
  summary: z.string(),
  source: z.string(),
  // The full, unmodified result object from the underlying engine. Kept as a passthrough
  // so no component field is lost, without this schema having to re-declare every engine
  // shape. It is auditable data, never re-interpreted.
  detail: z.unknown(),
});

export type ComponentCheck = z.infer<typeof ComponentCheckSchema>;

// --- Overall verdict -----------------------------------------------------------

// The unified verdict vocabulary. DETERMINISTIC function of the component verdicts:
//   supported             — at least one check ran and EVERY applicable check is positive
//                           (confirms the claim) with none contradicting or overstating.
//   partially_supported   — a mix of positive and weak/empty checks, none overstating.
//   overstated            — at least one check found the claim overstates what the data
//                           supports (e.g. overstated_certainty, potency overstated,
//                           phase overstated). This is the dangerous direction and wins.
//   unsupported           — checks ran but the evidence contradicts / fails to support
//                           the claim (e.g. reported_not_significant, benign consensus)
//                           without any positive check.
//   insufficient_evidence — no entity resolved to a runnable check, or every check that
//                           ran returned an honest empty (not_found / no_association).
export const OVERALL_VERDICTS = [
  "supported",
  "partially_supported",
  "overstated",
  "unsupported",
  "insufficient_evidence",
] as const;

export type OverallVerdict = (typeof OVERALL_VERDICTS)[number];

export const OverallVerdictSchema = z.enum(OVERALL_VERDICTS);

// The full unified result the composer returns and the route serializes. `checks` holds
// ONLY the engines that actually ran for the claim's entity profile; `overallVerdict` is
// the pure deterministic roll-up; `rationale` explains which rule fired (also
// deterministic — no LLM).
export const BiomedicalClaimVerificationSchema = z.object({
  claim: z.string(),
  entities: ClaimEntitiesSchema,
  checks: z.array(ComponentCheckSchema),
  overallVerdict: OverallVerdictSchema,
  rationale: z.string(),
});

export type BiomedicalClaimVerification = z.infer<
  typeof BiomedicalClaimVerificationSchema
>;

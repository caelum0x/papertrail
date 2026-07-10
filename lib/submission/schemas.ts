import { z } from "zod";

// Zod schemas + TypeScript types for the REGULATORY SUBMISSION BUNDLE
// (lib/submission/bundle.ts).
//
// A submission bundle is a regulator-facing MANIFEST that composes PaperTrail's
// already-verified artefacts — stored verifications and/or a composite evidence
// report — into a CTD/eCTD-style section map an auditor can read top to bottom:
//
//   Module 2.5  Summary of Findings  — the verdicts + certainty, one row each
//   Module 2.5  Methods              — the deterministic engines that produced them
//   Module 5    Evidence Table       — the numbers (effect sizes / GRADE / spans)
//   Provenance Appendix              — chain-of-custody: source ids, versions, hashes
//
// MOAT: assembly is DETERMINISTIC and NO LLM is anywhere in this file. Every number
// and every span is copied verbatim from an engine result that already produced it;
// nothing is generated, scored, or narrated here. Honest gaps (a verification with
// no matched source, an insufficient report, an ungroundable span) are LISTED in the
// bundle's `gaps` array rather than papered over. These schemas validate the request
// at the API boundary and give the assembler + UI a single shared, typed contract.

// --- Request -----------------------------------------------------------------

// The bundle is composed from any mix of stored verifications and one composite
// evidence report. At least one input must be supplied. Ids are validated as uuids
// so a malformed id fails at the boundary rather than in a SQL round-trip.
export const SubmissionBundleRequestSchema = z
  .object({
    verificationIds: z.array(z.string().uuid()).max(200).optional(),
    evidenceReportId: z.string().uuid().optional(),
  })
  .refine(
    (v) => (v.verificationIds?.length ?? 0) > 0 || Boolean(v.evidenceReportId),
    {
      message:
        "Provide at least one verificationId or an evidenceReportId to assemble a bundle.",
    }
  );
export type SubmissionBundleRequest = z.infer<
  typeof SubmissionBundleRequestSchema
>;

// --- Section vocabulary ------------------------------------------------------

// The CTD/eCTD-style sections a bundle always emits, in fixed regulatory order.
// A closed enum keeps the manifest shape stable and machine-checkable.
export const BUNDLE_SECTION_KINDS = [
  "summary_of_findings",
  "methods",
  "evidence_table",
  "provenance_appendix",
] as const;
export type BundleSectionKind = (typeof BUNDLE_SECTION_KINDS)[number];

// --- Chain-of-custody entry (mirrors lib/provenance/chainOfCustody.ts) --------

// One grounded span's full provenance tuple, copied verbatim from the deterministic
// chain-of-custody builder. `chain_of_custody_hash` is a sha256 over the ordered
// tuple with no wall-clock input, so it is reproducible + tamper-evident.
export const CustodyRecordSchema = z.object({
  verification_id: z.string(),
  source_id: z.string(),
  doi: z.string().nullable(),
  pmid: z.string().nullable(),
  source_version: z.string().nullable(),
  snapshot_date: z.string().nullable(),
  content_hash: z.string().nullable(),
  source_span: z.string(),
  span_start: z.number().int(),
  span_end: z.number().int(),
  chain_of_custody_hash: z.string(),
});
export type CustodyRecord = z.infer<typeof CustodyRecordSchema>;

// The provenance summary for a single verification: its source, the source-version
// that was in effect, the aggregate custody hash, per-span records, and the count of
// spans that could no longer be grounded (dropped, never fabricated).
export const CustodySummarySchema = z.object({
  verification_id: z.string(),
  source_id: z.string().nullable(),
  source_version: z.string().nullable(),
  snapshot_date: z.string().nullable(),
  content_hash: z.string().nullable(),
  doi: z.string().nullable(),
  pmid: z.string().nullable(),
  records: z.array(CustodyRecordSchema),
  dropped_ungroundable: z.number().int(),
  aggregate_hash: z.string(),
});
export type CustodySummary = z.infer<typeof CustodySummarySchema>;

// --- Summary-of-findings rows -------------------------------------------------

// One row of the executive Summary of Findings table. Either a stored verification
// (a claim-vs-source verdict + trust score) or the composite evidence report (a
// GRADE certainty + synthesis verdict). All fields are verbatim engine output.
export const FindingRowSchema = z.object({
  kind: z.enum(["verification", "evidence_report"]),
  ref_id: z.string(),
  claim: z.string(),
  // Verification axis (null for evidence-report rows).
  discrepancy_type: z.string().nullable(),
  trust_score: z.number().int().nullable(),
  // Evidence-report axis (null for verification rows).
  verdict: z.string().nullable(),
  certainty: z.string().nullable(),
  // Grounded-span count backing this row (0 when nothing could be grounded).
  grounded_spans: z.number().int(),
});
export type FindingRow = z.infer<typeof FindingRowSchema>;

// --- Methods -----------------------------------------------------------------

// One deterministic engine that contributed to the bundle, named so an auditor can
// see exactly which field-standard method produced each number. No prose is invented;
// these are fixed descriptions of the engines PaperTrail runs.
export const MethodEntrySchema = z.object({
  engine: z.string(),
  description: z.string(),
});
export type MethodEntry = z.infer<typeof MethodEntrySchema>;

// --- Evidence table ----------------------------------------------------------

// A quantitative pooled estimate row (present only when a composite evidence report
// with a poolable meta-analysis is included). Every number is copied off the report's
// random-effects estimate + GRADE result.
export const PooledEstimateSchema = z.object({
  measure: z.string(),
  point: z.number(),
  ci_lower: z.number(),
  ci_upper: z.number(),
  ci_pct: z.number(),
  studies: z.number().int(),
  i_squared: z.number(),
  significant: z.boolean(),
  certainty: z.string(),
  downgrades: z.array(
    z.object({ domain: z.string(), steps: z.number().int(), reason: z.string() })
  ),
});
export type PooledEstimate = z.infer<typeof PooledEstimateSchema>;

// --- Gaps --------------------------------------------------------------------

// The honesty ledger. Every reason a piece of requested evidence could NOT be fully
// assembled is recorded here rather than silently dropped or fabricated. Closed enum
// so the UI can label each gap precisely.
export const GAP_KINDS = [
  "verification_not_found",
  "no_matched_source",
  "no_grounded_spans",
  "ungroundable_spans_dropped",
  "evidence_report_not_found",
  "evidence_report_insufficient",
  "no_pooled_estimate",
] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export const BundleGapSchema = z.object({
  kind: z.enum(GAP_KINDS),
  ref_id: z.string().nullable(),
  detail: z.string(),
});
export type BundleGap = z.infer<typeof BundleGapSchema>;

// --- Manifest ----------------------------------------------------------------

// Bundle-level provenance/integrity header. `bundle_hash` is a sha256 over the
// canonical (key-sorted) manifest body with NO wall-clock input, so re-assembling
// the same underlying state yields a byte-identical hash — the manifest is its own
// tamper-evident seal. `generated_at` is carried OUTSIDE the hashed body.
export const BundleManifestSchema = z.object({
  org_id: z.string(),
  generated_at: z.string(),
  bundle_hash: z.string(),

  // Module 2.5 — Summary of Findings.
  summary_of_findings: z.array(FindingRowSchema),

  // Module 2.5 — Methods (the engines behind the numbers).
  methods: z.array(MethodEntrySchema),

  // Module 5 — Evidence table (pooled quantitative estimates, when present).
  evidence_table: z.array(PooledEstimateSchema),

  // Provenance appendix — chain of custody per verification.
  provenance_appendix: z.array(CustodySummarySchema),

  // Honesty ledger — everything that could not be assembled, listed not hidden.
  gaps: z.array(BundleGapSchema),

  // Coverage counters for a one-line auditability summary.
  counts: z.object({
    verifications_requested: z.number().int(),
    verifications_included: z.number().int(),
    evidence_reports_included: z.number().int(),
    grounded_spans: z.number().int(),
    dropped_ungroundable_spans: z.number().int(),
    gaps: z.number().int(),
  }),
});
export type BundleManifest = z.infer<typeof BundleManifestSchema>;

// Zod schemas + inferred types for the deterministic Real-World-Evidence (RWE)
// signal layer. These describe the SHAPE of the temporal evidence signals we
// compute from the open corpus (FAERS, PubMed E-utilities, ClinicalTrials.gov)
// — no proprietary EHR, no LLM in any number.
//
// Everything here is a plain data contract: the request accepted by /api/rwe and
// the deterministic profile it returns. The numeric derivations live in
// lib/rwe/signals.ts; this file only validates inputs at the boundary and gives
// the returned objects a single source-of-truth type.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

// A public RWE request. All three fields are optional individually, but the
// route requires at least one usable signal input (enforced by .refine below):
//   - drug + event   -> adverse-event disproportionality trend (FAERS)
//   - topic          -> evidence-volume trend (PubMed + ClinicalTrials.gov)
// A bare `drug` with no `event` cannot form a 2x2, so the AE trend needs both.
export const RweRequestSchema = z
  .object({
    drug: z.string().trim().min(1).max(200).optional(),
    topic: z.string().trim().min(1).max(300).optional(),
    event: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.topic) || (Boolean(v.drug) && Boolean(v.event)), {
    message:
      "Provide `topic` for an evidence-volume trend, and/or `drug`+`event` for an adverse-event trend.",
  });

export type RweRequest = z.infer<typeof RweRequestSchema>;

// ---------------------------------------------------------------------------
// Adverse-event trend (FAERS disproportionality over time)
// ---------------------------------------------------------------------------

export const TrendDirectionSchema = z.enum(["rising", "stable", "falling"]);
export type TrendDirection = z.infer<typeof TrendDirectionSchema>;

// One year of the adverse-event trend. `reports` is the raw FAERS count of
// (this drug + this event) that year (the `a` cell). `prr`/`ic` are the yearly
// disproportionality statistics; null when that year's 2x2 was degenerate.
export const AdverseEventYearSchema = z.object({
  year: z.number().int(),
  reports: z.number().int().nonnegative(),
  prr: z.number().nullable(),
  ic: z.number().nullable(),
  ic025: z.number().nullable(),
});
export type AdverseEventYear = z.infer<typeof AdverseEventYearSchema>;

export const AdverseEventTrendSchema = z.object({
  drug: z.string(),
  event: z.string(),
  years: z.array(AdverseEventYearSchema),
  // Deterministic ordinary-least-squares slope of IC vs. year (IC units/year).
  icSlope: z.number().nullable(),
  direction: TrendDirectionSchema,
  // Total raw reports across all observed years (sum of the `a` cells).
  totalReports: z.number().int().nonnegative(),
});
export type AdverseEventTrend = z.infer<typeof AdverseEventTrendSchema>;

// ---------------------------------------------------------------------------
// Evidence-volume trend (publications + trial starts over time)
// ---------------------------------------------------------------------------

export const YearCountSchema = z.object({
  year: z.number().int(),
  count: z.number().int().nonnegative(),
});
export type YearCount = z.infer<typeof YearCountSchema>;

export const EvidenceMaturitySchema = z.enum(["emerging", "active", "established"]);
export type EvidenceMaturity = z.infer<typeof EvidenceMaturitySchema>;

export const EvidenceVolumeTrendSchema = z.object({
  topic: z.string(),
  publications: z.array(YearCountSchema),
  trials: z.array(YearCountSchema),
  totalPublications: z.number().int().nonnegative(),
  totalTrials: z.number().int().nonnegative(),
  maturity: EvidenceMaturitySchema,
});
export type EvidenceVolumeTrend = z.infer<typeof EvidenceVolumeTrendSchema>;

// ---------------------------------------------------------------------------
// Combined profile
// ---------------------------------------------------------------------------

// The combined RWE profile. Either signal may be absent (null) when its inputs
// weren't supplied OR the upstream fetch failed — honest-empty, never faked.
// `summary` is a DETERMINISTIC one-line description assembled from the numbers
// above (no LLM); it exists so a caller can render a headline without re-deriving
// the thresholds.
export const RweProfileSchema = z.object({
  drug: z.string().nullable(),
  event: z.string().nullable(),
  topic: z.string().nullable(),
  adverseEventTrend: AdverseEventTrendSchema.nullable(),
  evidenceVolumeTrend: EvidenceVolumeTrendSchema.nullable(),
  summary: z.string(),
});
export type RweProfile = z.infer<typeof RweProfileSchema>;

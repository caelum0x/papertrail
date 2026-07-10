import { z } from "zod";

// Boundary + output validation for the PRISMA SYSTEMATIC-REVIEW AUTOPILOT.
// The autopilot orchestrates a whole review from a question: ingest → dedupe →
// AI-screen → extract → synthesise. Every structured value that crosses the public
// route boundary (in) or is derived from a Claude step (out) is shaped here so a
// route can hand raw JSON straight in and a client can rely on a stable contract.
//
// The autopilot chains EXISTING PaperTrail engines; these schemas do NOT redefine
// those engines' own types (RankedRecord, PaperExtractResult, BuildEvidenceReportResult).
// They validate the autopilot's REQUEST and describe its own PRISMA-flow summary.

// ---------------------------------------------------------------------------
// Request. `question` drives ingestion/screening; `criteria` are the inclusion
// criteria Claude screens each candidate against. A caller may either let the
// autopilot search+cache its own candidate sources (default) OR pin an explicit
// set of already-cached `source_ids` (reproducible demo runs, or "review THESE").
// ---------------------------------------------------------------------------
export const PrismaAutopilotInputSchema = z
  .object({
    question: z.string().trim().min(10).max(2000),
    // One inclusion criterion per array element. Empty array is allowed: Claude
    // then judges general topical relevance to the question (aiRank's own fallback).
    criteria: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    // OPTIONAL explicit candidate pool: cached source ids to review instead of
    // searching. When present, the autopilot skips ingestion entirely and screens
    // exactly these rows. Mutually informative with `question` (which still drives
    // screening/synthesis wording), so both may be supplied.
    source_ids: z.array(z.string().uuid()).max(200).optional(),
    // How many candidate sources to search+cache when `source_ids` is absent.
    // Bounded to protect the token/embedding budget on large runs (CLAUDE.md).
    limit: z.number().int().min(1).max(50).optional(),
    // Screening relevance threshold: records Claude scores at or above this are
    // INCLUDED (and then extracted). Below → excluded. Tunable so a reviewer can
    // trade sensitivity vs. specificity without touching the engine.
    include_threshold: z.number().min(0).max(1).optional(),
  })
  .strict();
export type PrismaAutopilotInput = z.infer<typeof PrismaAutopilotInputSchema>;

// ---------------------------------------------------------------------------
// PRISMA flow counts — the numbers behind a PRISMA flow diagram. Deliberately a
// SUPERSET-compatible shape with the review UI's PrismaCounts, but scoped to what
// the autopilot itself can produce from one automated pass (no full-text screening
// stage — screening is title/abstract only, extraction is the "assessed" stage).
// ---------------------------------------------------------------------------
export const PrismaFlowCountsSchema = z.object({
  // Candidate records gathered (searched+cached, or the pinned source_ids).
  identified: z.number().int().nonnegative(),
  // Duplicate candidate ids removed before screening.
  duplicatesRemoved: z.number().int().nonnegative(),
  // Records that reached AI title/abstract screening.
  screened: z.number().int().nonnegative(),
  // Records Claude excluded at screening (below the include threshold).
  excluded: z.number().int().nonnegative(),
  // Records Claude included at screening (carried forward to extraction).
  included: z.number().int().nonnegative(),
  // Of the included records, how many yielded ≥1 grounded effect at extraction.
  extractedWithEffects: z.number().int().nonnegative(),
});
export type PrismaFlowCounts = z.infer<typeof PrismaFlowCountsSchema>;

// One screened record's verdict, in the autopilot's own summary shape. Mirrors the
// RankedRecord fields the UI needs to render a screening worklist + PRISMA rationale.
export interface ScreenedRecordSummary {
  id: string;
  title: string;
  relevance: number;
  decision: "included" | "excluded";
  rationale: string;
  // Trust signal from aiRank: whether the rationale was grounded against the
  // record's own title/abstract (never a fabricated justification).
  groundingOk: boolean;
}

// One included record's extraction outcome, in summary form. The full grounded
// effects live under the engine's GroundedEffect type on the raw result; here we
// carry the per-record roll-up the PRISMA view needs.
export interface ExtractedRecordSummary {
  id: string;
  title: string;
  // How many effects survived exact-span grounding (unsourced numbers dropped).
  groundedEffectCount: number;
  // How many model-produced effects were dropped for being ungroundable.
  droppedEffectCount: number;
}

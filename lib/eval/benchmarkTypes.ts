import { z } from "zod";

// Types + Zod schema for the SciFact-derived benchmark harness. A BenchmarkCase
// is the neutral, PaperTrail-shaped unit the benchmark runner consumes: a claim
// paired with the exact source text it should be verified against, plus the gold
// label we grade the pipeline's verdict against.
//
// This crosses a data boundary (we read gitignored JSONL at eval time and a
// committed JSON fixture), so everything is validated through the Zod schema
// before use — never trust raw JSON.parse output. See lib/eval/schemas.ts for
// the discrepancy-type contract this maps onto.

// The three-way gold label. SciFact evidence with a SUPPORT label -> SUPPORT,
// CONTRADICT label -> CONTRADICT, empty evidence -> NEI (not enough info).
// PaperTrail's discrepancy_type maps back onto this:
//   accurate                                  -> SUPPORT
//   magnitude_overstated / population_over-
//     generalized / caveat_dropped            -> CONTRADICT (a flagged distortion)
//   no_support_found / no confident match     -> NEI
export const GOLD_LABELS = ["SUPPORT", "CONTRADICT", "NEI"] as const;
export const goldLabelSchema = z.enum(GOLD_LABELS);
export type GoldLabel = z.infer<typeof goldLabelSchema>;

// One benchmark row. `sourceText` is the joined title + abstract of the cited
// corpus doc(s) — the raw_text PaperTrail verifies the claim against. When a
// claim cites multiple docs, their texts are joined so the source is a single
// self-contained string.
export const benchmarkCaseSchema = z.object({
  // Stable id for the case. Derived from the SciFact claim id (stringified) so
  // results can be traced back to the source dataset.
  id: z.string().min(1, "benchmark case id is required."),
  claim: z.string().trim().min(1, "claim text is required."),
  sourceText: z.string().trim().min(1, "sourceText is required."),
  goldLabel: goldLabelSchema,
  // The SciFact corpus doc ids this claim was cited against (the SOURCE docs).
  citedDocIds: z.array(z.number().int()).min(1, "at least one cited doc id is required."),
});

export type BenchmarkCase = z.infer<typeof benchmarkCaseSchema>;

// The committed fixture is just an array of cases. Parse the whole file through
// this so a malformed fixture fails loudly at load time rather than mid-run.
export const benchmarkCaseArraySchema = z.array(benchmarkCaseSchema);

// Splits available in the SciFact release under reference/scifact/data/data.
export const SCIFACT_SPLITS = ["train", "dev", "test"] as const;
export const scifactSplitSchema = z.enum(SCIFACT_SPLITS);
export type ScifactSplit = z.infer<typeof scifactSplitSchema>;

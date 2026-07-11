// LAB NOTEBOOK COMPANION — deterministic REPRODUCIBILITY CHECK.
//
// A wet-lab record is only reproducible if it carries the details another scientist needs
// to run it again: an antibody without a dilution, a reagent without a vendor/catalog
// number, a protocol with no stated controls or sample size — these are the gaps that
// silently break reproducibility. This module inspects the ALREADY-STRUCTURED experiment
// and flags those gaps as amber "add for reproducibility" hints.
//
// It is 100% deterministic and derived only from fields Claude already extracted+grounded:
//   - NO new LLM call.
//   - NO invented data — a hint never asserts a value, it only points out a MISSING one.
//   - It reads the structured record read-only and returns a NEW list (no mutation).
//
// This keeps PaperTrail's trust contract intact: the reproducibility layer can only ever
// say "this detail appears to be missing", never fill it in with a guessed value.

import type { StructuredExperiment } from "./schemas";

// A single reproducibility gap. `severity` is always "amber": these are helpful hints for
// a stronger record, never hard errors (a scientist may legitimately omit some of them).
export interface ReproducibilityHint {
  // Stable machine id for the rule that fired — handy for keys/telemetry, never shown raw.
  id: string;
  // Which structured section the gap is about, so the UI can group/point at it.
  section: "reagents" | "samples" | "protocol" | "observations";
  // Short human-readable gap description, e.g. 'Antibody "anti-p53" has no dilution stated'.
  message: string;
  // Why it matters for reproducibility — the "add for reproducibility" rationale.
  detail: string;
}

export interface ReproducibilityReport {
  hints: ReproducibilityHint[];
  // True when the record has NO detectable reproducibility gaps — lets the UI show a
  // positive "looks reproducible" state instead of an empty void.
  clean: boolean;
}

// ---------------------------------------------------------------------------
// Detection helpers — all pure string inspection over already-structured fields.
// We deliberately keep the heuristics conservative: only flag a gap when the relevant
// signal is present (e.g. the reagent is clearly an antibody) but its companion detail
// (a dilution) is absent, so we don't nag about details that don't apply.
// ---------------------------------------------------------------------------

// Words that mark a reagent as an antibody, for which a dilution/concentration is the
// reproducibility-critical missing detail.
const ANTIBODY_MARKERS = [
  "antibody",
  "antibodies",
  "anti-",
  "mab",
  "igg",
  "primary ab",
  "secondary ab",
];

// A dilution or concentration signal, in either the reagent's amount or its grounded
// source span (e.g. "1:1000", "2 ug/ml", "5% milk", "10 nM"). If any of these appear the
// antibody's working concentration is considered stated.
const DILUTION_PATTERN =
  /(\d+\s*:\s*\d+)|(\d+(\.\d+)?\s*(x)\b)|(\d+(\.\d+)?\s*(%|µg|ug|mg|ng|µm|um|nm|mm|m|ml|µl|ul|l)\b)|(\d+(\.\d+)?\s*(µg|ug|mg|ng)\s*\/\s*(ml|µl|ul|l))/i;

// Terms in the notes/structure that indicate a control condition is present. Reproducibility
// hinges on knowing what the experiment was compared against.
const CONTROL_MARKERS = [
  "control",
  "ctrl",
  "mock",
  "vehicle",
  "untreated",
  "wild-type",
  "wild type",
  "wt ",
  "negative",
  "positive",
  "sham",
  "baseline",
  "loading ctrl",
  "loading control",
];

// A replicate / sample-size signal: explicit n=, "in triplicate", "3 replicates", etc.
const SAMPLE_SIZE_PATTERN =
  /\b(n\s*=\s*\d+)|(\d+\s*(biological|technical)?\s*replicates?)|(triplicate|duplicate|quadruplicate)|(\d+\s*wells?)\b/i;

function includesAny(haystack: string, needles: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

function looksLikeAntibody(name: string, span: string): boolean {
  return includesAny(`${name} ${span}`, ANTIBODY_MARKERS);
}

function hasDilution(...fields: (string | null)[]): boolean {
  return fields.some((f) => f !== null && DILUTION_PATTERN.test(f));
}

// ---------------------------------------------------------------------------
// Individual rules. Each returns zero or more hints for its section.
// ---------------------------------------------------------------------------

// Reagents: flag antibodies with no dilution, and reagents with no vendor AND no catalog
// number (either alone is usually enough to source it again).
function reagentHints(
  reagents: StructuredExperiment["reagents"]
): ReproducibilityHint[] {
  const hints: ReproducibilityHint[] = [];

  reagents.forEach((r, i) => {
    if (
      looksLikeAntibody(r.name, r.source_span) &&
      !hasDilution(r.amount, r.source_span)
    ) {
      hints.push({
        id: `antibody-dilution-${i}`,
        section: "reagents",
        message: `Antibody "${r.name}" has no working dilution or concentration.`,
        detail:
          "State the dilution (e.g. 1:1000) or concentration so the immunostain/blot can be reproduced.",
      });
    }

    if (r.vendor === null && r.catalog === null) {
      hints.push({
        id: `reagent-source-${i}`,
        section: "reagents",
        message: `Reagent "${r.name}" has no vendor or catalog number.`,
        detail:
          "Add a vendor and/or catalog number so another lab can order the exact same reagent.",
      });
    }
  });

  return hints;
}

// Samples: flag when no sample condition mentions a control, and when no sample states a
// replicate count / sample size. Both are computed across the whole samples array (a
// single control/n=… anywhere satisfies the check).
function sampleHints(
  samples: StructuredExperiment["samples"]
): ReproducibilityHint[] {
  if (samples.length === 0) return [];

  const hints: ReproducibilityHint[] = [];
  const combined = samples.map((s) => `${s.text} ${s.source_span}`).join(" • ");

  if (!includesAny(combined, CONTROL_MARKERS)) {
    hints.push({
      id: "samples-no-control",
      section: "samples",
      message: "No control condition is recorded among the samples.",
      detail:
        "Note the control/comparison group (e.g. mock, vehicle, untreated) — results are only interpretable against a control.",
    });
  }

  if (!SAMPLE_SIZE_PATTERN.test(combined)) {
    hints.push({
      id: "samples-no-size",
      section: "samples",
      message: "No sample size or replicate count is recorded.",
      detail:
        "State n / replicates (e.g. n=3, in triplicate) so the result's reliability can be judged and reproduced.",
    });
  }

  return hints;
}

// Protocol: flag the "did it, recorded no readout" gap — steps exist but nothing was
// observed or concluded, which leaves the experiment without a reproducible result.
function protocolHints(
  structured: StructuredExperiment
): ReproducibilityHint[] {
  const hints: ReproducibilityHint[] = [];

  if (
    structured.protocol_steps.length > 0 &&
    structured.observations.length === 0 &&
    structured.outcomes.length === 0
  ) {
    hints.push({
      id: "protocol-no-readout",
      section: "protocol",
      message: "A protocol is recorded but no observations or outcomes were captured.",
      detail:
        "Record what was measured/seen so the experiment has a reproducible readout, not just steps.",
    });
  }

  return hints;
}

// ---------------------------------------------------------------------------
// Orchestrator.
// ---------------------------------------------------------------------------

/**
 * Compute deterministic "add for reproducibility" hints for an already-structured
 * experiment record. Pure and side-effect-free: it reads the structured fields and returns
 * a NEW report. It never invents a value — a hint only ever flags a MISSING detail, so the
 * grounding/trust contract is preserved (nothing here is presented as sourced from notes).
 */
export function checkReproducibility(
  structured: StructuredExperiment
): ReproducibilityReport {
  const hints: ReproducibilityHint[] = [
    ...reagentHints(structured.reagents),
    ...sampleHints(structured.samples),
    ...protocolHints(structured),
  ];

  return { hints, clean: hints.length === 0 };
}

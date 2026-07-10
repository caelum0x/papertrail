// LAB NOTEBOOK COMPANION — structure a wet-lab scientist's rough bench notes into a
// reproducible, searchable experiment record.
//
// The flow:
//   1. REASON (Claude). Hand Claude the raw notes and ask it to extract protocol steps,
//      reagents, samples, equipment, observations, outcomes, next steps and normalized
//      entities — with a verbatim source_span on every field that quotes the notes.
//      callClaudeForJson validates the output against StructuredExperimentSchema (Zod).
//   2. ENFORCE GROUNDING (deterministic). For every field carrying a source_span, run
//      locateSpan(rawNotes, span). If it can't be located the quote is not real — drop
//      that item (protocol step / reagent / sample / observation / outcome) and COUNT
//      the drop. PaperTrail never makes an unsourced claim about a source, so a step
//      Claude "remembered" but can't point to in the notes is discarded, not shown.
//
// Claude does the genuinely hard part — turning terse, abbreviation-heavy bench shorthand
// into a clean reproducible record and canonicalising the entities — but every quoted
// field is anchored to text the scientist actually wrote. This file performs no DB or
// network I/O beyond the Claude call, which is injectable so tests run offline.

import { callClaudeForJson } from "@/lib/claude";
import { locateSpan } from "@/lib/grounding";
import {
  StructuredExperimentSchema,
  type ProtocolStep,
  type Reagent,
  type Sample,
  type Observation,
  type Outcome,
  type StructuredExperiment,
} from "./schemas";

// A Claude caller narrowed to this engine's contract, injectable so tests run offline
// (no Anthropic API needed) — mirrors lib/hypotheses/generate.ts.
export type StructureLlm = (params: {
  system: string;
  user: string;
}) => Promise<StructuredExperiment>;

const defaultLlm: StructureLlm = (params) =>
  callClaudeForJson({
    system: params.system,
    user: params.user,
    schema: StructuredExperimentSchema,
    maxTokens: 2500,
  });

// The system prompt makes the grounding contract explicit to the model: quote verbatim,
// never invent reagents/steps that aren't in the notes, normalize the entities.
const SYSTEM_PROMPT = `You are a laboratory-notebook assistant for a wet-lab scientist at a disease-focused research lab. You are given the scientist's ROUGH bench notes (possibly a voice-memo transcript: terse, abbreviated, out of order). Turn them into a structured, reproducible experiment record.

Extract, from ONLY what the notes actually say:
- objective: one or two sentences on what the experiment was trying to establish.
- protocol_steps: the procedure as ordered steps (order starts at 1). Split run-on notes into discrete steps.
- reagents: each reagent/compound/buffer used, with vendor, catalog number and amount/concentration IF stated (else null).
- samples: the biological samples / conditions / groups.
- equipment: instruments and equipment named (plain strings).
- observations: what was seen/measured during the run.
- outcomes: the results / conclusions the notes report.
- next_steps: follow-ups the notes mention (plain strings).
- entities: normalized bio entities the notes reference — type is one of gene|protein|cell_line|reagent|organism|method|other, name is the canonical form (you MAY expand an abbreviation here).
- suggested_title: a concise descriptive title for the experiment.
- suggested_date: the experiment date IF the notes state one (YYYY-MM-DD if possible), else null.

HARD RULES — you will be audited against them:
- For every protocol_step, reagent, sample, observation and outcome, set source_span to a VERBATIM substring copied EXACTLY from the notes (same characters) that this item is drawn from. Do not paraphrase the source_span.
- NEVER invent reagents, steps, samples, observations or outcomes that are not in the notes. If the notes don't mention amounts/vendors/catalog numbers, use null — do not guess plausible values.
- entities, equipment, objective, next_steps and suggested_title are your normalized summary and do NOT need a source_span, but must still be faithful to the notes.
- If the notes are too sparse to fill an array, return it empty rather than fabricating.

Return ONLY a JSON object matching this shape:
{"objective":"...","protocol_steps":[{"order":1,"text":"...","source_span":"..."}],"reagents":[{"name":"...","vendor":null,"catalog":null,"amount":null,"source_span":"..."}],"samples":[{"text":"...","source_span":"..."}],"equipment":["..."],"observations":[{"text":"...","source_span":"..."}],"outcomes":[{"text":"...","source_span":"..."}],"next_steps":["..."],"entities":[{"type":"gene","name":"..."}],"suggested_title":"...","suggested_date":null}`;

function buildUserPrompt(rawNotes: string): string {
  return [
    "RAW BENCH NOTES (structure ONLY what these say; quote verbatim in every source_span):",
    "---",
    rawNotes,
    "---",
    "Produce the structured experiment record per the rules. JSON only.",
  ].join("\n");
}

// Keep an item only if its source_span is a verbatim substring of the raw notes. When it
// is, replace the span with the exact located text (locateSpan tolerates whitespace
// differences but always returns the verbatim source slice). Returns the kept items plus
// how many were dropped for being ungroundable.
function groundSpanned<T extends { source_span: string }>(
  items: readonly T[],
  rawNotes: string
): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let dropped = 0;
  for (const item of items) {
    const located = locateSpan(rawNotes, item.source_span);
    if (!located) {
      dropped += 1;
      continue;
    }
    kept.push({ ...item, source_span: located.text });
  }
  return { kept, dropped };
}

/**
 * Structure a wet-lab scientist's rough bench notes into a reproducible experiment
 * record, then ENFORCE the grounding invariant: every field that quotes the notes must
 * carry a source_span that is a verbatim substring of the notes; ungroundable items are
 * dropped and counted. Returns a NEW structured object (inputs are not mutated). The
 * Claude caller is injectable so tests run without the Anthropic API.
 */
export async function structureExperiment(
  rawNotes: string,
  opts?: { llm?: StructureLlm }
): Promise<{ structured: StructuredExperiment; droppedUngrounded: number }> {
  const llm = opts?.llm ?? defaultLlm;
  const raw = await llm({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(rawNotes),
  });

  const steps = groundSpanned<ProtocolStep>(raw.protocol_steps, rawNotes);
  const reagents = groundSpanned<Reagent>(raw.reagents, rawNotes);
  const samples = groundSpanned<Sample>(raw.samples, rawNotes);
  const observations = groundSpanned<Observation>(raw.observations, rawNotes);
  const outcomes = groundSpanned<Outcome>(raw.outcomes, rawNotes);

  // Re-number surviving protocol steps so the reproducible record stays 1..n contiguous
  // even after ungroundable steps were dropped.
  const renumberedSteps = steps.kept.map((step, index) => ({
    ...step,
    order: index + 1,
  }));

  const structured: StructuredExperiment = {
    ...raw,
    protocol_steps: renumberedSteps,
    reagents: reagents.kept,
    samples: samples.kept,
    observations: observations.kept,
    outcomes: outcomes.kept,
  };

  const droppedUngrounded =
    steps.dropped +
    reagents.dropped +
    samples.dropped +
    observations.dropped +
    outcomes.dropped;

  return { structured, droppedUngrounded };
}

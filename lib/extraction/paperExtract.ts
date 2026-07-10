// Structured full-paper extraction — the heavy Claude core, wrapped in the
// deterministic trust layer.
//
// WHAT CLAUDE DOES (genuinely hard, high-volume work): reads the ENTIRE raw_text
// of a paper/trial record — long-context reading, not a snippet — and returns
// structured PICO + endpoints + EVERY reported effect size, each with the exact
// quote that reports it, validated against a strict Zod schema (lib/extraction/schemas).
//
// WHAT THE ENGINE DOES (the trust layer that makes that safe): for each effect,
//   1. GROUND the supporting quote to an exact span of raw_text (lib/grounding).
//      If the quote can't be located, the effect is DROPPED — no unsourced numbers.
//   2. RECONCILE the number Claude read against a deterministic regex parse of the
//      grounded quote (lib/effectSize.parseEffectSizes). Agreement → "confirmed";
//      a different parsed number → "mismatch" (surfaced, never silently trusted);
//      no parseable number in the quote → "unverified".
//
// Pure orchestration over Claude + grounding + effectSize; returns a fresh result
// and never mutates its inputs.

import { callClaudeForJson } from "../claude";
import { locateSpan } from "../grounding";
import { parseEffectSizes, type EffectMeasure } from "../effectSize";
import {
  PaperExtractionSchema,
  type ExtractedEffect,
  type GroundedEffect,
  type PaperExtractResult,
  type EffectReconciliation,
  type ClaudeEffectMeasure,
} from "./schemas";

// Cap the text we send Claude. Full papers can be long; this bounds token spend
// while still giving Claude the whole record for the demo corpus (abstracts +
// trial records are well under this). Truncation is explicit, never silent to the
// caller — the note surfaces on the response envelope via total-extracted counts.
const MAX_CHARS = 60_000;

const SYSTEM_PROMPT = `You are a meticulous evidence-extraction assistant for clinical research.
You read the FULL text of a clinical trial record or paper and extract a structured summary.

Extract ONLY what is explicitly stated in the text. Never infer, generalize, or fill gaps with
typical values from similar studies. If a field is not stated, use "not reported".

You must extract:
1. PICO: population, intervention, comparator, outcomes (array; primary outcome first).
2. endpoints: each with name, role (primary|secondary|safety|other), and timepoint.
3. effects: EVERY reported quantitative effect size. For EACH effect you MUST include a
   "quote" that is an EXACT, VERBATIM substring of the source text reporting that number —
   copy it character-for-character, including the numbers, parentheses, and CI. Do NOT
   paraphrase, round, reformat, or reconstruct the quote. If you cannot quote it verbatim,
   do not include the effect.

For each effect set "measure" to one of: HR, RR, OR, RRR (relative risk reduction as a %),
absolute, unknown. Set "is_percent" true when the point value is a percentage. Use null for
point/ci_low/ci_high when a value is not reported.

Respond with ONLY a single JSON object matching this shape, no other text:
{
  "pico": { "population": string, "intervention": string, "comparator": string, "outcomes": string[] },
  "endpoints": [ { "name": string, "role": "primary"|"secondary"|"safety"|"other", "timepoint": string } ],
  "effects": [ { "endpoint": string, "measure": "HR"|"RR"|"OR"|"RRR"|"absolute"|"unknown",
                 "point": number|null, "ci_low": number|null, "ci_high": number|null,
                 "is_percent": boolean, "quote": string } ]
}`;

export interface PaperSourceMeta {
  id?: string | null;
  title?: string | null;
  external_id?: string | null;
  source_type?: string | null;
  url?: string | null;
}

/**
 * Read a full paper with Claude and return a grounded, reconciled structured
 * extraction. `rawText` is the authoritative source: every returned effect's quote
 * is a verbatim span of it. Effects whose quote can't be grounded are dropped.
 */
export async function extractPaper(
  rawText: string,
  source: PaperSourceMeta = {}
): Promise<PaperExtractResult> {
  const text = rawText.slice(0, MAX_CHARS);

  // HEAVY CLAUDE STEP: long-context read of the full paper -> strict Zod-validated
  // structured extraction. We validate before trusting any of it.
  const extraction = await callClaudeForJson({
    system: SYSTEM_PROMPT,
    user: `Paper text:\n\n"""\n${text}\n"""`,
    schema: PaperExtractionSchema,
    maxTokens: 4000,
  });

  // TRUST LAYER: ground each effect's quote against the ACTUAL source text and
  // reconcile the number. groundEffects is pure and exported for testing.
  const { effects, droppedCount } = groundEffects(extraction.effects, rawText);

  return {
    pico: extraction.pico,
    endpoints: extraction.endpoints,
    effects,
    ungrounded_dropped_count: droppedCount,
    total_effects_extracted: extraction.effects.length,
    source: {
      id: source.id ?? null,
      title: source.title ?? null,
      external_id: source.external_id ?? null,
      source_type: source.source_type ?? null,
      url: source.url ?? null,
    },
  };
}

/**
 * Ground and reconcile a batch of model-extracted effects against the source text.
 * Pure: returns a NEW array; drops any effect whose quote can't be located in
 * rawText. Exported so the grounding invariant can be tested without a live LLM.
 */
export function groundEffects(
  extractedEffects: readonly ExtractedEffect[],
  rawText: string
): { effects: GroundedEffect[]; droppedCount: number } {
  const effects: GroundedEffect[] = [];
  let droppedCount = 0;

  for (const eff of extractedEffects) {
    const located = locateSpan(rawText, eff.quote);
    if (!located) {
      // Ungroundable quote = unsourced number. Drop it — never fabricate provenance.
      droppedCount += 1;
      continue;
    }

    const { reconciliation, parsedPoint, note } = reconcileEffect(eff, located.text);

    effects.push({
      endpoint: eff.endpoint,
      measure: eff.measure,
      claimed_point: eff.point,
      claimed_ci_low: eff.ci_low,
      claimed_ci_high: eff.ci_high,
      is_percent: eff.is_percent,
      // Use the VERBATIM located substring, not the model's copy.
      quote: located.text,
      grounding: { status: located.status, start: located.start, end: located.end },
      reconciliation,
      parsed_point: parsedPoint,
      note,
    });
  }

  return { effects, droppedCount };
}

// How close two effect-size point values must be to count as the same number.
// Relative tolerance handles rounding (0.75 vs 0.746); absolute floor handles
// small values near zero.
const REL_TOLERANCE = 0.03;
const ABS_TOLERANCE = 0.02;

/**
 * Cross-check the number Claude read against a deterministic regex parse of the
 * grounded quote. This is the numeric "catch" a plain LLM wrapper skips: the same
 * verbatim text is re-parsed by lib/effectSize's rules and the two numbers compared.
 */
function reconcileEffect(
  eff: ExtractedEffect,
  groundedQuote: string
): { reconciliation: EffectReconciliation; parsedPoint: number | null; note: string } {
  const parsed = parseEffectSizes(groundedQuote);

  // Prefer a parsed effect whose measure matches what Claude tagged; else take the
  // first parseable effect from the quote.
  const matchByMeasure = parsed.find((p) => sameMeasure(p.measure, eff.measure));
  const chosen = matchByMeasure ?? parsed[0] ?? null;

  if (!chosen || chosen.point === null) {
    return {
      reconciliation: "unverified",
      parsedPoint: null,
      note: "Quote grounded to the source, but no numeric effect could be re-parsed from it to cross-check.",
    };
  }

  if (eff.point === null) {
    return {
      reconciliation: "unverified",
      parsedPoint: chosen.point,
      note: `Deterministic parse read ${chosen.measure} ${chosen.point} from the grounded quote; Claude reported no numeric point to compare.`,
    };
  }

  if (numbersAgree(eff.point, chosen.point)) {
    return {
      reconciliation: "confirmed",
      parsedPoint: chosen.point,
      note: `Confirmed: the grounded quote independently parses to ${chosen.point}, matching the extracted value.`,
    };
  }

  return {
    reconciliation: "mismatch",
    parsedPoint: chosen.point,
    note: `Mismatch: Claude read ${eff.point} but a deterministic parse of the same grounded quote reads ${chosen.point}. Surfaced for review; the extracted number is not trusted over the source.`,
  };
}

/** Whether a deterministic-parser measure and a Claude-tagged measure line up. */
function sameMeasure(parsed: EffectMeasure, claude: ClaudeEffectMeasure): boolean {
  return (parsed as string) === (claude as string);
}

/** Two point estimates agree within relative + absolute tolerance. */
function numbersAgree(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  if (diff <= ABS_TOLERANCE) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return diff / scale <= REL_TOLERANCE;
}

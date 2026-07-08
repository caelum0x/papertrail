import { FlaggedSpan, VerificationResult } from "./schemas";

// PaperTrail's core trust guarantee: every flagged source_span must be a real,
// locatable substring of the cached source raw_text. The LLM is *asked* to quote
// exactly, but nothing in the model output guarantees it. This module makes the
// guarantee a CODE invariant: we locate each span in raw_text, replace it with the
// verbatim text we actually found (with char offsets for in-place highlighting),
// and DROP any span we cannot locate. A span we can't point to in the source is,
// by definition, an unsourced claim about the source — and PaperTrail never makes one.

export type SpanGroundingStatus = "exact" | "approximate";

export interface GroundedSpan {
  claim_span: string;
  /** The verbatim substring of raw_text we located (not the model's paraphrase). */
  source_span: string;
  issue: string;
  grounding: {
    status: SpanGroundingStatus;
    /** Character offsets into raw_text, for highlighting the span in place. */
    start: number;
    end: number;
  };
}

export interface GroundingResult {
  spans: GroundedSpan[];
  /** Spans the model returned that could not be located in raw_text and were dropped. */
  droppedCount: number;
}

/** A verification result whose flagged spans have all been grounded in the source. */
export interface GroundedVerificationResult extends Omit<VerificationResult, "flagged_spans"> {
  flagged_spans: GroundedSpan[];
  /** How many model-produced spans were dropped for being ungroundable. */
  grounding_dropped_count: number;
}

/**
 * Apply the grounding invariant to a raw verification result: replace its flagged
 * spans with grounded ones (verbatim text + offsets), dropping any that can't be
 * located in the source. Returns a NEW object; the input is not mutated.
 */
export function groundVerificationResult(
  result: VerificationResult,
  rawText: string
): GroundedVerificationResult {
  const { spans, droppedCount } = groundFlaggedSpans(result.flagged_spans, rawText);
  return {
    ...result,
    flagged_spans: spans,
    grounding_dropped_count: droppedCount,
  };
}

/**
 * Locate a candidate span inside the source text.
 * Tier 1: exact substring match (case- and whitespace-exact).
 * Tier 2: whitespace-normalized match — tolerates the model collapsing or altering
 *         runs of whitespace, but still recovers the exact original substring.
 * Returns null if the span cannot be located either way.
 */
export function locateSpan(
  rawText: string,
  candidate: string
): { status: SpanGroundingStatus; start: number; end: number; text: string } | null {
  const trimmed = candidate.trim();
  if (trimmed.length === 0) return null;

  // Tier 1 — exact.
  const exactIdx = rawText.indexOf(trimmed);
  if (exactIdx !== -1) {
    return { status: "exact", start: exactIdx, end: exactIdx + trimmed.length, text: trimmed };
  }

  // Tier 2 — whitespace-normalized, with a map back to original offsets so we can
  // return the *verbatim* source text (never the normalized or model version).
  const { normalized, offsets } = normalizeWithOffsets(rawText);
  const normCandidate = trimmed.replace(/\s+/g, " ");
  const normIdx = normalized.indexOf(normCandidate);
  if (normIdx !== -1) {
    const start = offsets[normIdx];
    // End maps from the last matched normalized char back to its original index (+1).
    const lastNormChar = normIdx + normCandidate.length - 1;
    const end = offsets[lastNormChar] + 1;
    return { status: "approximate", start, end, text: rawText.slice(start, end) };
  }

  return null;
}

/**
 * Ground every flagged span against the source. Returns a NEW array of grounded
 * spans (verbatim text + offsets); spans that can't be located are dropped.
 */
export function groundFlaggedSpans(
  flaggedSpans: readonly FlaggedSpan[],
  rawText: string
): GroundingResult {
  const spans: GroundedSpan[] = [];
  let droppedCount = 0;

  for (const span of flaggedSpans) {
    const located = locateSpan(rawText, span.source_span);
    if (!located) {
      droppedCount += 1;
      continue;
    }
    spans.push({
      claim_span: span.claim_span,
      source_span: located.text,
      issue: span.issue,
      grounding: { status: located.status, start: located.start, end: located.end },
    });
  }

  return { spans, droppedCount };
}

/**
 * Produce a whitespace-collapsed copy of `text` alongside an offset map, where
 * offsets[i] is the index in the ORIGINAL text of the i-th character of the
 * normalized text. Leading whitespace and repeated whitespace collapse to a single
 * space that maps to the first original whitespace character in the run.
 */
function normalizeWithOffsets(text: string): { normalized: string; offsets: number[] } {
  let normalized = "";
  const offsets: number[] = [];
  let inWhitespace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!inWhitespace) {
        normalized += " ";
        offsets.push(i);
        inWhitespace = true;
      }
    } else {
      normalized += ch;
      offsets.push(i);
      inWhitespace = false;
    }
  }

  return { normalized, offsets };
}

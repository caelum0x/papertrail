"use client";

/**
 * SourceHighlight — the hero demo view.
 *
 * Renders a cached source passage with PaperTrail's flagged spans highlighted
 * IN PLACE, using the exact character offsets already computed by
 * lib/grounding.ts (GroundedSpan.grounding.start/end). Offsets are authoritative:
 * we slice `rawText` by those offsets and NEVER indexOf the span text, so what a
 * judge sees highlighted is provably the same substring the grounding layer located.
 *
 * "exact" flags render in rose/red; "approximate" flags render in amber. Each mark
 * carries an id (span-${i}) so a future citation list can scroll to it, and exposes
 * its issue on hover/focus (title attribute + ring).
 */

import { useMemo } from "react";
import { GroundedSpan } from "@/lib/grounding";

export interface SourceHighlightProps {
  rawText: string;
  spans: GroundedSpan[];
  /** Prefix for each mark's DOM id (id=`${idPrefix}-${spanIndex}`). Must be unique
   *  per instance on a page so two columns don't collide / enable scroll-linking. */
  idPrefix?: string;
}

/** A contiguous slice of the passage: either plain text or a flagged span. */
export interface Segment {
  text: string;
  start: number;
  end: number;
  /** Index into the ORIGINAL spans array when flagged; null for plain text. */
  spanIndex: number | null;
  span: GroundedSpan | null;
}

/**
 * Partition `rawText` into a non-overlapping, gap-free list of segments.
 *
 * Pure: does not mutate its inputs. Spans are sorted by grounding.start; any span
 * with out-of-range offsets, or that overlaps a span already placed, is skipped
 * (never throws). Plain-text gaps between placed spans become plain segments, so
 * the returned segments always concatenate back to the full `rawText`.
 */
export function buildSegments(rawText: string, spans: GroundedSpan[]): Segment[] {
  const placed = orderPlaceableSpans(rawText, spans);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const { span, spanIndex } of placed) {
    const { start, end } = span.grounding;
    if (start > cursor) {
      segments.push(plainSegment(rawText, cursor, start));
    }
    segments.push({
      text: rawText.slice(start, end),
      start,
      end,
      spanIndex,
      span,
    });
    cursor = end;
  }

  if (cursor < rawText.length) {
    segments.push(plainSegment(rawText, cursor, rawText.length));
  }

  return segments;
}

/** Sort spans by start and drop out-of-range or overlapping ones, keeping original indices. */
function orderPlaceableSpans(
  rawText: string,
  spans: GroundedSpan[]
): ReadonlyArray<{ span: GroundedSpan; spanIndex: number }> {
  const candidates = spans
    .map((span, spanIndex) => ({ span, spanIndex }))
    .filter(({ span }) => isInRange(span, rawText.length))
    .sort((a, b) => a.span.grounding.start - b.span.grounding.start);

  const placed: Array<{ span: GroundedSpan; spanIndex: number }> = [];
  let lastEnd = 0;
  for (const candidate of candidates) {
    if (candidate.span.grounding.start >= lastEnd) {
      placed.push(candidate);
      lastEnd = candidate.span.grounding.end;
    }
  }
  return placed;
}

function isInRange(span: GroundedSpan, length: number): boolean {
  const { start, end } = span.grounding;
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end <= length &&
    start < end
  );
}

function plainSegment(rawText: string, start: number, end: number): Segment {
  return { text: rawText.slice(start, end), start, end, spanIndex: null, span: null };
}

function markClasses(status: GroundedSpan["grounding"]["status"]): string {
  const base =
    "rounded px-0.5 transition outline-none focus:ring-2 hover:ring-2 cursor-help";
  if (status === "approximate") {
    return `${base} bg-amber-100 text-amber-900 ring-amber-400 focus:ring-amber-400`;
  }
  return `${base} bg-rose-100 text-rose-900 ring-rose-400 focus:ring-rose-400`;
}

export function SourceHighlight({ rawText, spans, idPrefix = "span" }: SourceHighlightProps) {
  const segments = useMemo(() => buildSegments(rawText, spans), [rawText, spans]);

  return (
    <div className="max-h-96 overflow-y-auto rounded-lg border border-ink/10 bg-white p-4">
      <p className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-ink/80">
        {segments.map((segment, i) =>
          segment.span === null ? (
            <span key={i}>{segment.text}</span>
          ) : (
            <mark
              key={i}
              id={`${idPrefix}-${segment.spanIndex}`}
              tabIndex={0}
              title={segment.span.issue}
              className={markClasses(segment.span.grounding.status)}
            >
              {segment.text}
            </mark>
          )
        )}
      </p>
    </div>
  );
}

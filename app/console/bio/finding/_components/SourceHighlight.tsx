// Renders the source text with the grounded effect-size spans highlighted.
//
// Highlighting is driven ONLY by verbatim offsets returned by the deterministic
// verifier: a span is highlighted where its [sourceStart, sourceEnd) maps into
// the provided source text. Spans without offsets (or that fall outside the
// text) are skipped here — they are still listed as dropped/ungrounded elsewhere.
// Nothing is fuzzy-matched; we never invent a highlight the engine didn't ground.

import { Fragment } from "react";
import type { GroundedSpan } from "./types";

interface Segment {
  text: string;
  highlighted: boolean;
  label?: string | null;
}

// Build non-overlapping, ordered segments from the source text and the grounded
// spans that carry valid offsets. Deterministic: sort by start, skip overlaps.
function buildSegments(source: string, spans: GroundedSpan[]): Segment[] {
  const valid = spans
    .filter(
      (s): s is GroundedSpan & { sourceStart: number; sourceEnd: number } =>
        typeof s.sourceStart === "number" &&
        typeof s.sourceEnd === "number" &&
        s.sourceStart >= 0 &&
        s.sourceEnd <= source.length &&
        s.sourceStart < s.sourceEnd
    )
    .sort((a, b) => a.sourceStart - b.sourceStart);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const span of valid) {
    if (span.sourceStart < cursor) continue; // skip overlapping span
    if (span.sourceStart > cursor) {
      segments.push({ text: source.slice(cursor, span.sourceStart), highlighted: false });
    }
    segments.push({
      text: source.slice(span.sourceStart, span.sourceEnd),
      highlighted: true,
      label: span.label,
    });
    cursor = span.sourceEnd;
  }
  if (cursor < source.length) {
    segments.push({ text: source.slice(cursor), highlighted: false });
  }
  return segments;
}

export function SourceHighlight({
  source,
  spans,
}: {
  source: string;
  spans: GroundedSpan[];
}) {
  const segments = buildSegments(source, spans);
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">Grounded source text</h3>
      <p className="mt-1 text-xs text-ink/40">
        Highlighted spans are grounded verbatim to the effect sizes verified above.
      </p>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/80">
        {segments.map((seg, i) =>
          seg.highlighted ? (
            <mark
              key={i}
              title={seg.label ?? undefined}
              className="rounded bg-accent/15 px-0.5 text-ink"
            >
              {seg.text}
            </mark>
          ) : (
            <Fragment key={i}>{seg.text}</Fragment>
          )
        )}
      </p>
    </div>
  );
}

// One verified sentence in the drafted section. Renders the (possibly corrected)
// prose with a per-sentence marker: green "grounded" when the engine confirmed it,
// amber "corrected" when an overstatement was rewritten to the engine's value. A
// corrected sentence shows what changed; a grounded quote shows the exact source span.

import type { VerifiedSentence } from "./types";

interface SentenceViewProps {
  sentence: VerifiedSentence;
  index: number;
}

function Marker({ sentence }: { sentence: VerifiedSentence }) {
  if (sentence.corrected) {
    return (
      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
        corrected
      </span>
    );
  }
  if (sentence.grounded) {
    return (
      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        grounded
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-semibold text-ink/40">
      unverified
    </span>
  );
}

export function SentenceView({ sentence, index }: SentenceViewProps) {
  const borderTone = sentence.corrected
    ? "border-l-amber-400"
    : sentence.grounded
      ? "border-l-emerald-400"
      : "border-l-ink/15";

  return (
    <div className={`border-l-2 ${borderTone} pl-3`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] leading-relaxed text-ink/85">
          <span className="mr-1.5 text-xs text-ink/30">{index + 1}.</span>
          {sentence.text}
        </p>
        <Marker sentence={sentence} />
      </div>

      {sentence.corrected ? (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <div className="font-medium">Auto-corrected against the engine</div>
          <p className="mt-1 leading-relaxed">{sentence.corrected.reason}</p>
          <p className="mt-1.5 italic text-amber-700/80 line-through">
            {sentence.corrected.original}
          </p>
        </div>
      ) : null}

      {sentence.quote ? (
        <blockquote className="mt-2 rounded-lg border border-ink/10 bg-white px-3 py-2 text-xs text-ink/60">
          <span className="mr-1 font-medium text-ink/50">
            {sentence.quote.source_title ?? sentence.quote.source_type}:
          </span>
          &ldquo;{sentence.quote.quote}&rdquo;
          {sentence.quote.status === "approximate" ? (
            <span className="ml-1 text-[10px] uppercase text-ink/30">(approx. match)</span>
          ) : null}
        </blockquote>
      ) : null}
    </div>
  );
}

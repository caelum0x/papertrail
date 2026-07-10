import type { GroundedCitationClassification } from "@/lib/citations/schemas";

// Renders the citing passage with the grounded citation-context sentence highlighted
// in place, using the char offsets the trust layer produced. Because the offsets
// come from lib/grounding.ts (a real substring of the citing text), the highlight is
// guaranteed to line up — no fuzzy re-search in the browser.

interface GroundedContextProps {
  citingText: string;
  classification: GroundedCitationClassification;
}

export function GroundedContext({ citingText, classification }: GroundedContextProps) {
  const { start, end, status } = classification.grounding;
  const before = citingText.slice(0, start);
  const highlight = citingText.slice(start, end);
  const after = citingText.slice(end);

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
          Citation context (grounded to the citing text)
        </p>
        <span className="font-mono text-[10px] text-ink/30">
          chars {start}–{end} · {status}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">
        {before}
        <mark className="rounded bg-accent/20 px-0.5 text-ink/90">{highlight}</mark>
        {after}
      </p>

      <div className="mt-4 border-t border-ink/10 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
          Why this stance
        </p>
        <p className="mt-1 text-sm text-ink/60">{classification.reasoning}</p>
      </div>
    </div>
  );
}

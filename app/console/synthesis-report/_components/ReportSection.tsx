import type { GroundedSectionView, ReportSourceView } from "./types";

// Renders one grounded section of the review. Each sentence flows into a paragraph;
// factual (grounded) sentences carry a small citation chip listing the sources they
// were grounded to, so a reader can see at a glance which prose is source-backed and
// which is connective. Sentences with no grounding are still shown (they state no
// source-specific fact) but carry no chip.

interface ReportSectionProps {
  section: GroundedSectionView;
  sourceIndex: ReadonlyMap<string, number>;
}

function citationLabel(
  citations: readonly string[],
  sourceIndex: ReadonlyMap<string, number>
): string | null {
  const nums = citations
    .map((id) => sourceIndex.get(id))
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  return nums.map((n) => `[${n}]`).join("");
}

export function ReportSection({ section, sourceIndex }: ReportSectionProps) {
  if (section.sentences.length === 0) {
    return (
      <section className="rounded-lg border border-ink/15 bg-white p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          {section.heading}
        </h3>
        <p className="mt-2 text-sm italic text-ink/40">
          No source-grounded content for this section.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-ink/15 bg-white p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
        {section.heading}
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink/80">
        {section.sentences.map((s, i) => {
          const cite = s.grounding ? citationLabel(s.citations, sourceIndex) : null;
          return (
            <span key={i}>
              {s.text}
              {cite ? (
                <sup
                  className="ml-0.5 font-medium text-accent"
                  title={
                    s.grounding
                      ? `Grounded (${s.grounding.status}) to: "${s.grounding.source_span.slice(0, 140)}"`
                      : undefined
                  }
                >
                  {cite}
                </sup>
              ) : null}{" "}
            </span>
          );
        })}
      </p>
    </section>
  );
}

interface CitationTrailProps {
  sources: readonly ReportSourceView[];
  sourceIndex: ReadonlyMap<string, number>;
}

export function CitationTrail({ sources, sourceIndex }: CitationTrailProps) {
  if (sources.length === 0) return null;
  return (
    <section className="rounded-lg border border-ink/15 bg-white p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
        Sources
      </h3>
      <ol className="mt-2 space-y-1 text-sm text-ink/70">
        {sources.map((s) => {
          const n = sourceIndex.get(s.id);
          return (
            <li key={s.id} className="flex gap-2">
              <span className="font-medium text-accent">[{n}]</span>
              <span>
                {s.title ?? "(untitled source)"}{" "}
                <span className="text-ink/40">· {s.source_type}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

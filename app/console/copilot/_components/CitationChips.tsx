import type { Citation } from "@/lib/copilot/schemas";

// The grounded citation trail for an answer: numbered chips linking out to each
// primary source the copilot's tools actually returned. The [n] markers match the
// inline citations in the answer text. Because these come only from tool results,
// every chip points at a real cached source — nothing here is model-fabricated.

interface CitationChipsProps {
  citations: Citation[];
}

const TYPE_LABELS: Record<string, string> = {
  pubmed: "PubMed",
  clinicaltrials: "ClinicalTrials.gov",
};

export function CitationChips({ citations }: CitationChipsProps) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-3 border-t border-ink/10 pt-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink/30">
        Sources
      </div>
      <div className="flex flex-col gap-1">
        {citations.map((c) => (
          <a
            key={c.index}
            href={c.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-2 text-xs text-ink/70 hover:text-accent"
          >
            <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink/10 text-[10px] font-medium text-ink/60 group-hover:bg-accent/15 group-hover:text-accent">
              {c.index}
            </span>
            <span className="min-w-0">
              <span className="group-hover:underline">
                {c.title ?? c.external_id ?? c.url}
              </span>
              <span className="ml-1.5 text-[10px] text-ink/35">
                {TYPE_LABELS[c.source_type] ?? c.source_type}
                {c.external_id ? ` · ${c.external_id}` : ""}
              </span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

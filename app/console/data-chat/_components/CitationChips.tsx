import type { DataCitation } from "./types";

// The grounded citation trail for an answer: numbered chips linking to each item
// from the ORG'S OWN library that the agent's tools actually returned — a saved
// evidence report, a cached primary source, or a filed claim. The [n] markers match
// the inline citations in the answer text. Because these come only from org-scoped
// tool results, every chip points at a real object in the caller's tenant — nothing
// here is model-fabricated, and nothing crosses tenants.

interface CitationChipsProps {
  citations: DataCitation[];
}

const KIND_LABELS: Record<DataCitation["kind"], string> = {
  evidence_report: "Saved report",
  source: "Source",
  claim: "Claim",
};

// Report/claim citations link into the console (relative href); source citations
// link out to the external primary record (ref is an absolute url, href is null).
function linkFor(c: DataCitation): { href: string; external: boolean } {
  if (c.href) return { href: c.href, external: false };
  return { href: c.ref, external: true };
}

export function CitationChips({ citations }: CitationChipsProps) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-3 border-t border-ink/10 pt-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink/30">
        From your library
      </div>
      <div className="flex flex-col gap-1">
        {citations.map((c) => {
          const link = linkFor(c);
          return (
            <a
              key={c.index}
              href={link.href}
              {...(link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className="group flex items-start gap-2 text-xs text-ink/70 hover:text-accent"
            >
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink/10 text-[10px] font-medium text-ink/60 group-hover:bg-accent/15 group-hover:text-accent">
                {c.index}
              </span>
              <span className="min-w-0">
                <span className="group-hover:underline">{c.title ?? c.ref}</span>
                <span className="ml-1.5 text-[10px] text-ink/35">{KIND_LABELS[c.kind]}</span>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

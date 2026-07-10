import type { DeepResearchClaim, DeepResearchSource } from "./types";

// Renders a list of grounded claims. Each claim shows its sentence and, beneath
// it, the exact verbatim source spans it cites (already grounded server-side —
// what you see was located character-for-character in a real source raw_text).

interface ClaimListProps {
  claims: DeepResearchClaim[];
  sources: DeepResearchSource[];
}

function sourceLabel(source: DeepResearchSource | undefined, id: string): string {
  if (!source) return id;
  return source.title ?? `${source.source_type} ${id}`;
}

export function ClaimList({ claims, sources }: ClaimListProps) {
  if (claims.length === 0) {
    return (
      <p className="text-sm text-ink/40">
        No claim here could be grounded to an exact source span, so none are shown.
      </p>
    );
  }

  const byId = new Map(sources.map((s) => [s.id, s]));

  return (
    <ol className="space-y-4">
      {claims.map((claim, i) => (
        <li key={i} className="rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-sm leading-relaxed text-ink/80">{claim.text}</p>
          <ul className="mt-3 space-y-2">
            {claim.citations.map((cite, j) => (
              <li key={j} className="border-l-2 border-accent/40 pl-3">
                <p className="text-xs italic text-ink/60">“{cite.quote}”</p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-ink/35">
                  {sourceLabel(byId.get(cite.source_id), cite.source_id)}
                  {cite.grounding.status === "approximate" ? " · whitespace-matched" : " · exact"}
                </p>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

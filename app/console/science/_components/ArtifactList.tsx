import type { ScienceMessage } from "@/lib/science/clientTypes";

// Renders the structured artifacts (literature queries, citations, next steps)
// attached to an assistant message.

interface ArtifactListProps {
  message: ScienceMessage;
}

export function ArtifactList({ message }: ArtifactListProps) {
  const a = message.artifacts;
  const hasAny =
    a.literatureQueries.length > 0 ||
    a.citations.length > 0 ||
    a.nextSteps.length > 0;
  if (!hasAny) return null;

  return (
    <div className="mt-3 space-y-3 border-t border-ink/10 pt-3">
      {a.literatureQueries.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-ink/60">Literature queries</p>
          <ul className="mt-1 space-y-1">
            {a.literatureQueries.map((q, i) => (
              <li key={i} className="text-sm text-ink/70">
                <code className="rounded bg-paper px-1 py-0.5 text-xs">{q}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {a.citations.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-ink/60">Suggested sources</p>
          <ul className="mt-1 space-y-1">
            {a.citations.map((c, i) => (
              <li key={i} className="text-sm text-ink/70">
                <span className="font-medium">{c.title}</span>{" "}
                <span className="text-ink/40">— {c.source}</span>
                {c.note ? (
                  <span className="block text-xs text-ink/40">{c.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {a.nextSteps.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-ink/60">Next steps</p>
          <ul className="mt-1 list-disc pl-5 space-y-1">
            {a.nextSteps.map((s, i) => (
              <li key={i} className="text-sm text-ink/70">
                {s}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

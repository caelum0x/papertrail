import Link from "next/link";
import { SearchTypeBadge } from "@/components/search/SearchTypeBadge";
import type { SearchGroup, SearchResult } from "@/components/search/types";

interface ResultRowProps {
  result: SearchResult;
}

// A single search hit: type badge, title, and optional snippet, linking to the
// entity.
function ResultRow({ result }: ResultRowProps) {
  return (
    <li className="rounded-lg border border-ink/10 bg-white p-4 hover:border-accent/40">
      <Link href={result.href} className="flex items-start gap-3">
        <SearchTypeBadge type={result.type} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink/80">
            {result.title}
          </span>
          {result.snippet ? (
            <span className="mt-0.5 block truncate text-xs text-ink/40">
              {result.snippet}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

interface ResultsGroupProps {
  group: SearchGroup;
}

// A titled group of results for one entity type.
function ResultsGroup({ group }: ResultsGroupProps) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink/60">
        {group.label}
        <span className="text-xs font-normal text-ink/40">
          {group.results.length}
        </span>
      </h2>
      <ul className="space-y-2">
        {group.results.map((result) => (
          <ResultRow key={`${result.type}-${result.id}`} result={result} />
        ))}
      </ul>
    </section>
  );
}

interface SearchResultsProps {
  groups: SearchGroup[];
}

// Renders all result groups in display order.
export function SearchResults({ groups }: SearchResultsProps) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <ResultsGroup key={group.type} group={group} />
      ))}
    </div>
  );
}

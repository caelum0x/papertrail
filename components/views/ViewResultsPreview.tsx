import Link from "next/link";
import { RESOURCE_LABELS, type SavedViewDto } from "./api";
import { QuerySummary } from "./QuerySummary";

interface ViewResultsPreviewProps {
  view: SavedViewDto;
}

// Detail-page panel that explains what the view does and links to the target
// resource's list page with the view applied. Actual result rows live in each
// module's own list page (via SavedViewBar); this panel is the bridge to it.
export function ViewResultsPreview({ view }: ViewResultsPreviewProps) {
  const targetHref = `/console/${view.resource}?view=${view.id}`;

  return (
    <div className="space-y-4 rounded-lg border border-ink/10 bg-white p-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-ink/40">Query</p>
        <div className="mt-2">
          <QuerySummary query={view.query} />
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink/40">Resource</dt>
          <dd className="text-sm text-ink/70">
            {RESOURCE_LABELS[view.resource]}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink/40">Filters</dt>
          <dd className="text-sm text-ink/70">{view.query.filters.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink/40">Sort clauses</dt>
          <dd className="text-sm text-ink/70">{view.query.sort.length}</dd>
        </div>
      </dl>

      <div className="border-t border-ink/10 pt-4">
        <Link
          href={targetHref}
          className="inline-block rounded bg-accent px-4 py-2 text-sm text-white hover:opacity-90"
        >
          Open in {RESOURCE_LABELS[view.resource]}
        </Link>
        <p className="mt-2 text-xs text-ink/40">
          Applies this view to the {RESOURCE_LABELS[view.resource].toLowerCase()}{" "}
          list.
        </p>
      </div>
    </div>
  );
}

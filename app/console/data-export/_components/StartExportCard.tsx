import Link from "next/link";

interface StartExportCardProps {
  canEdit: boolean;
}

// Call-to-action card on the overview page pointing to the guided export wizard.
// When the user lacks editor rights, it explains why the action is unavailable.
export function StartExportCard({ canEdit }: StartExportCardProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink/80">Start a new export</h2>
          <p className="mt-1 max-w-md text-sm text-ink/50">
            Export claims, verifications, evidence, documents, or references from
            this workspace to CSV or JSON. Everything stays scoped to your
            organization.
          </p>
        </div>
        {canEdit ? (
          <Link
            href="/console/data-export/new"
            className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            New export
          </Link>
        ) : (
          <span className="shrink-0 text-xs text-ink/40">
            Editor role required
          </span>
        )}
      </div>
    </div>
  );
}

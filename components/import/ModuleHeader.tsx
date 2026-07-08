import Link from "next/link";

// Page header for the import module list view: title, blurb, and a primary CTA.

export function ModuleHeader() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Import &amp; export</h1>
        <p className="mt-1 text-sm text-ink/60">
          Bulk-load claims, evidence, or references from CSV, BibTeX, or RIS files.
        </p>
      </div>
      <Link
        href="/console/import/new"
        className="shrink-0 rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90"
      >
        New import
      </Link>
    </div>
  );
}

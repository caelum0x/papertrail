import Link from "next/link";

// Prominent entry point shown above the history table. Explains the three-step
// flow and links into the wizard.

export function StartImportCard() {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink/80">Start a new import</h2>
      <p className="mt-1 text-sm text-ink/60">
        Paste or upload a file, map its columns to the target fields, preview the
        result, then commit. Nothing is written until you commit.
      </p>
      <ol className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink/60">
        <li>1. Upload CSV / BibTeX / RIS</li>
        <li>2. Map columns</li>
        <li>3. Preview</li>
        <li>4. Commit</li>
      </ol>
      <Link
        href="/console/import/new"
        className="mt-4 inline-block rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90"
      >
        Start import
      </Link>
    </div>
  );
}

import Link from "next/link";

// Header for the search page: title, hint about the ⌘K palette, and a link to
// the search tips sub-page.
export function SearchHeader() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Search</h1>
        <p className="mt-1 text-sm text-ink/40">
          Search across claims, documents, evidence, and verifications in this
          workspace. Press{" "}
          <kbd className="rounded border border-ink/10 bg-paper px-1 text-[11px]">
            ⌘K
          </kbd>{" "}
          anywhere for the quick palette.
        </p>
      </div>
      <Link
        href="/console/search/tips"
        className="text-sm text-accent hover:underline shrink-0"
      >
        Search tips
      </Link>
    </div>
  );
}

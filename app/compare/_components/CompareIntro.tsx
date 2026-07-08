import Link from "next/link";

export function CompareIntro() {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold text-ink">Bring your own source</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink/60">
        Check a claim against source text you paste directly — an abstract, a results
        passage, or any record. No PubMed retrieval or database lookup is involved; the
        claim is verified only against the text below, so this works even for sources
        PaperTrail can&apos;t fetch.
      </p>
      <Link href="/" className="mt-3 inline-block text-xs text-accent hover:underline">
        ← Back to search-based verification
      </Link>
    </div>
  );
}

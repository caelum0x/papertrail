import Link from "next/link";

export function EvalHeader() {
  return (
    <>
      <header className="mb-8 flex items-baseline justify-between">
        <Link href="/" className="text-2xl font-semibold hover:underline">
          PaperTrail
        </Link>
        <Link href="/" className="text-sm text-accent hover:underline">
          Check a claim →
        </Link>
      </header>

      <h1 className="mb-2 text-sm font-medium uppercase tracking-wide text-ink/40">
        Accuracy, in the open
      </h1>
      <p className="mb-6 max-w-2xl text-sm text-ink/60">
        Every verification PaperTrail emits must ground each flagged span in an exact,
        verbatim substring of the cached source text — an ungrounded span is a hard
        failure of the harness, not a soft miss. This is a stronger guarantee than a
        confidence score alone: it means the tool cannot claim the source says something
        the source does not literally say.
      </p>
    </>
  );
}

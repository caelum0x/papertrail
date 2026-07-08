import Link from "next/link";

export function RecentHeader() {
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
      <h1 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink/40">Recent verifications</h1>
    </>
  );
}

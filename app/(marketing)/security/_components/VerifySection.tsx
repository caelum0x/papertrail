import Link from "next/link";

export function VerifySection() {
  return (
    <section>
      <h2 className="text-lg font-semibold">Verify for yourself</h2>
      <p className="mt-3 text-sm leading-relaxed text-ink/80">
        The public trust summary — capability list and build info, no tenant data — is available
        at{" "}
        <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">/api/trust/summary</code>. The
        grounding invariant that enforces provenance is covered by tests that fail loudly if it is
        ever weakened.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/about" className="text-accent hover:underline">
          Read the methodology →
        </Link>
        <Link href="/docs-hub" className="text-accent hover:underline">
          Documentation →
        </Link>
      </div>
    </section>
  );
}

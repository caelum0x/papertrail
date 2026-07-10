import Image from "next/image";
import Link from "next/link";

// Marketing hero for the public landing. Uses the PaperTrail logo, a one-line
// value prop, and two CTAs: primary to workspace signup, secondary to the live
// org console. House tokens only (bg-paper, text-ink, accent, border-ink/15).
export function MarketingHero() {
  return (
    <section className="mx-auto max-w-3xl px-6 pt-10 pb-4 text-center">
      <Image
        src="/logo.png"
        alt="PaperTrail"
        width={72}
        height={48}
        priority
        className="mx-auto mb-6 h-14 w-auto"
      />
      <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
        Prove every number in your citation
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-lg text-ink/60">
        Claude reads the literature; a deterministic engine proves every number.
        Paste an efficacy claim and PaperTrail traces it to the primary source,
        extracts the actual finding, and flags exactly where the two diverge.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/register"
          className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-paper transition hover:bg-ink/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          Create your workspace
        </Link>
        <Link
          href="/console/claims"
          className="rounded-lg border border-ink/15 bg-white px-5 py-2.5 text-sm font-medium text-ink transition hover:bg-ink/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
        >
          Open the live console
        </Link>
      </div>
      <p className="mt-4 text-xs text-ink/40">
        Or try it right now — paste a claim below.
      </p>
    </section>
  );
}

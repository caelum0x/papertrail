import Link from "next/link";

export function ExploreSection() {
  return (
    <section>
      <h2 className="text-lg font-semibold">Explore</h2>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/about" className="text-accent hover:underline">
          How it works in detail →
        </Link>
        <Link href="/security" className="text-accent hover:underline">
          Security &amp; trust center →
        </Link>
        <Link href="/pricing" className="text-accent hover:underline">
          Pricing →
        </Link>
        <Link href="/docs-hub" className="text-accent hover:underline">
          Documentation →
        </Link>
      </div>
    </section>
  );
}

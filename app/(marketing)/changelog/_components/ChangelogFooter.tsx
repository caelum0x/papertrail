import Link from "next/link";

export function ChangelogFooter() {
  return (
    <section className="mt-10">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/product" className="text-accent hover:underline">
          Product overview →
        </Link>
        <Link href="/docs-hub" className="text-accent hover:underline">
          Documentation →
        </Link>
      </div>
    </section>
  );
}

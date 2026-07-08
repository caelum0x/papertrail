import Link from "next/link";

export function RecentChangesSection() {
  return (
    <section>
      <h2 className="text-lg font-semibold">Recent changes</h2>
      <p className="mt-3 text-sm leading-relaxed text-ink/80">
        See the{" "}
        <Link href="/changelog" className="text-accent hover:underline">
          changelog
        </Link>{" "}
        for what has shipped.
      </p>
    </section>
  );
}

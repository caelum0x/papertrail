import Link from "next/link";

export function DashboardHeader() {
  return (
    <>
      <header className="mb-8 flex items-baseline justify-between">
        <Link href="/" className="text-2xl font-semibold hover:underline">
          PaperTrail
        </Link>
        <nav className="flex gap-4 text-sm text-accent">
          <Link href="/recent" className="hover:underline">
            Recent
          </Link>
          <Link href="/sources" className="hover:underline">
            Sources
          </Link>
        </nav>
      </header>
      <h1 className="mb-6 text-sm font-medium uppercase tracking-wide text-ink/40">Dashboard</h1>
    </>
  );
}

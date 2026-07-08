import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <header className="mb-6">
        <p className="text-xs font-semibold text-accent">404</p>
        <h1 className="mt-1 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink/60">
          The page you were looking for doesn&apos;t exist, or may have moved. Head
          back to the verifier to check a claim against its primary source.
        </p>
      </header>

      <Link
        href="/"
        className="inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
      >
        Back to Verify
      </Link>
    </main>
  );
}

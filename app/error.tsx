"use client";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorPageProps) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink/60">
          PaperTrail hit an unexpected error while handling this page. Nothing was
          saved incorrectly — you can try again, and if the problem persists, reload
          the page or come back in a moment.
        </p>
      </header>

      {error.digest ? (
        <p className="mb-6 text-xs text-ink/40">
          Reference:{" "}
          <code className="rounded bg-ink/5 px-1 py-0.5 text-ink/60">{error.digest}</code>
        </p>
      ) : null}

      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90"
      >
        Try again
      </button>
    </main>
  );
}

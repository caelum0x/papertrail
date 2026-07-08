export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <div className="animate-pulse space-y-4" role="status" aria-label="Loading">
        <div className="h-7 w-1/2 rounded bg-ink/10" />
        <div className="h-4 w-3/4 rounded bg-ink/10" />
        <div className="h-32 w-full rounded-lg border border-ink/10 bg-white" />
      </div>
      <p className="mt-6 text-sm text-ink/40">Loading…</p>
    </main>
  );
}

export function GroundingNote() {
  return (
    <section className="mt-8 rounded-lg border border-ink/10 bg-white p-6">
      <h2 className="text-xs font-medium uppercase tracking-wide text-ink/40">
        On the span-grounding guarantee
      </h2>
      <p className="mt-3 text-sm text-ink/60">
        PaperTrail enforces that every flagged span maps back to a verbatim substring
        of the cached source, so its span-grounding rate is 100% by construction rather
        than an estimate. For context, published evaluations of general-purpose
        retrieval and citation tools have reported quote/attribution match rates well
        below 100% (for example, studies of AI answer engines have found substantial
        fractions of citations that do not support the associated statement). That
        figure is cited only as external context on the problem space — it is not a
        measurement of PaperTrail. PaperTrail&apos;s own numbers are the ones shown
        above, and only after{" "}
        <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">npm run eval</code> has
        been run.
      </p>
    </section>
  );
}

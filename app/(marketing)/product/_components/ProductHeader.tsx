export function ProductHeader() {
  return (
    <header className="mb-10">
      <h1 className="text-2xl font-semibold">PaperTrail</h1>
      <p className="mt-2 text-sm text-ink/60">
        A provenance and verification agent for clinical-trial efficacy claims.
      </p>
      <p className="mt-4 text-sm leading-relaxed text-ink/80">
        Paste a claim like &ldquo;Drug X reduced events by 30%.&rdquo; PaperTrail finds the
        primary source in PubMed or ClinicalTrials.gov, extracts what the source actually found,
        and flags any discrepancy — with every flag anchored to the exact words in the source.
      </p>
    </header>
  );
}

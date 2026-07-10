interface Feature {
  title: string;
  body: string;
}

// Real, shipping capabilities — kept truthful to what exists in the codebase.
const FEATURES: readonly Feature[] = [
  {
    title: "Claim verification",
    body: "Trace a clinical-trial efficacy claim to its primary source, extract the actual finding, and flag exaggeration or dropped caveats — with a deterministic numeric check on every reported figure.",
  },
  {
    title: "Evidence synthesis",
    body: "Pool findings across studies with a random-effects meta-analysis engine, surfacing effect sizes, heterogeneity, and cross-source agreement instead of a single cherry-picked trial.",
  },
  {
    title: "Biomedical evidence",
    body: "Ground claims in genetics, drug safety, and target biology — variant pathogenicity, pharmacovigilance signals, and target-disease associations, normalized to canonical entities.",
  },
  {
    title: "Research copilot",
    body: "Ask questions across your cached corpus and get answers anchored to exact source spans — a paper-QA assistant that never asserts a fact it cannot cite.",
  },
  {
    title: "Systematic review",
    body: "Run PRISMA-style screening and living-evidence tracking, so a review stays current as new trials land rather than freezing on the day it was written.",
  },
  {
    title: "Provenance & audit",
    body: "Every flag maps to a verbatim substring of the cached source, and every org action is written to an append-only audit trail you can export.",
  },
];

// Feature grid highlighting real PaperTrail capabilities. House tokens only.
export function FeatureGrid() {
  return (
    <section aria-labelledby="features-heading" className="mx-auto max-w-5xl px-6 py-14">
      <div className="mx-auto max-w-2xl text-center">
        <h2 id="features-heading" className="text-2xl font-semibold tracking-tight text-ink">
          One pipeline, from a single claim to a defensible answer
        </h2>
        <p className="mt-3 text-sm text-ink/60">
          Retrieval, extraction, verification, and synthesis — each step
          cited, each number checked by rule.
        </p>
      </div>
      <ul className="mt-10 grid gap-px overflow-hidden rounded-xl border border-ink/15 bg-ink/10 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature.title} className="bg-white p-6">
            <h3 className="text-sm font-medium text-accent">{feature.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/60">{feature.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

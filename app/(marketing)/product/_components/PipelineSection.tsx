import type { Feature } from "./types";

const PIPELINE: readonly Feature[] = [
  {
    title: "Retrieval",
    description:
      "The claim is embedded and matched against cached PubMed and ClinicalTrials.gov sources with pgvector similarity search. Sources are cached on first fetch, so verification never depends on live external-API latency.",
  },
  {
    title: "Extraction",
    description:
      "Claude reads the matched source and extracts a structured finding — effect size, population, endpoint, and caveats — validated against a strict schema before use. Raw model JSON is never trusted unvalidated.",
  },
  {
    title: "Verification",
    description:
      "Claude compares the claim to the extracted finding and pairs its verdict with a deterministic effect-size cross-check over parsed estimates and confidence intervals. The result is a discrepancy type, a trust score, and exact flagged spans.",
  },
] as const;

export function PipelineSection() {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold">How it works</h2>
      <ol className="mt-5 space-y-4">
        {PIPELINE.map((stage, i) => (
          <li key={stage.title} className="rounded-lg border border-ink/10 bg-white p-5">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-accent">Stage {i + 1}</span>
              <h3 className="text-base font-semibold">{stage.title}</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink/80">{stage.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

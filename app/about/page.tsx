import type { Metadata } from "next";
import { Section, Prose } from "./_components/Section";
import { Pipeline } from "./_components/Pipeline";
import { DiscrepancyTaxonomy } from "./_components/DiscrepancyTaxonomy";
import { Limitations } from "./_components/Limitations";
import { ExploreLinks } from "./_components/ExploreLinks";

export const metadata: Metadata = {
  title: "How it works — PaperTrail",
  description:
    "How PaperTrail verifies clinical-trial efficacy claims against their primary sources and registered results, with code-enforced exact-span provenance.",
};

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold">How PaperTrail works</h1>
        <p className="mt-2 text-sm text-ink/60">
          The methodology behind every flag it raises — and why the numbers can be trusted.
        </p>
      </header>

      <Section title="What PaperTrail does">
        <Prose>
          <p>
            Researchers and regulated evidence teams cite dozens of primary sources under deadline
            pressure. Claims drift from what the source actually says: effect sizes get rounded up,
            caveats get dropped, and findings get stated more broadly than the trial established.
          </p>
          <p>
            You submit a claim; PaperTrail traces it to the primary source in PubMed or
            ClinicalTrials.gov, extracts what the source actually found, and flags any discrepancy —
            with every flag anchored to the exact words in the source, and every number checked
            against the trial&apos;s own registered result.
          </p>
        </Prose>
      </Section>

      <Section title="The three-stage pipeline">
        <p className="mb-5 text-sm leading-relaxed text-ink/80">
          A submitted claim moves through three agents in sequence; each stage caches its work.
        </p>
        <Pipeline />
      </Section>

      <Section title="The grounding guarantee">
        <Prose>
          <p>
            The verification model is <em>asked</em> to quote the source exactly, but nothing about a
            model response guarantees its quotes are real. PaperTrail makes that a code-enforced
            invariant: every flagged span is located inside the cached source before it is shown, and
            any span that cannot be located is dropped.
          </p>
          <p>
            A span that cannot be pointed to in the source is, by definition, an unsourced claim about
            the source — so PaperTrail structurally cannot make one. This lives in{" "}
            <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">lib/grounding.ts</code>, covered by
            tests that fail loudly if the invariant is weakened.
          </p>
        </Prose>
      </Section>

      <Section title="Discrepancy taxonomy">
        <p className="mb-5 text-sm leading-relaxed text-ink/80">
          Every verification resolves to exactly one of five outcomes.
        </p>
        <DiscrepancyTaxonomy />
      </Section>

      <Section title="Honest limitations">
        <p className="mb-4 text-sm leading-relaxed text-ink/80">
          The verification core is scoped to do one thing well. It deliberately does not:
        </p>
        <Limitations />
      </Section>

      <section>
        <h2 className="text-lg font-semibold">Explore</h2>
        <div className="mt-3">
          <ExploreLinks />
        </div>
      </section>
    </main>
  );
}

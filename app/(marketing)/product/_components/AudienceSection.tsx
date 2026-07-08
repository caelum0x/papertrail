import type { Feature } from "./types";

const WHO: readonly Feature[] = [
  {
    title: "Translational researchers & postdocs",
    description:
      "Drafting a grant progress report or manuscript, citing sources they may not have re-read recently, and personally accountable for every claim to reviewers, funders, and their PI.",
  },
  {
    title: "Medical & regulatory reviewers",
    description:
      "Checking that efficacy statements in publications and communications faithfully represent the underlying trial evidence, with an auditable citation trail behind every flag.",
  },
] as const;

export function AudienceSection() {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold">Who it&rsquo;s for</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {WHO.map((w) => (
          <div key={w.title} className="rounded-lg border border-ink/10 bg-white p-5">
            <h3 className="text-base font-semibold">{w.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/80">{w.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

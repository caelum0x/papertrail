interface ValueProp {
  title: string;
  body: string;
}

const VALUE_PROPS: readonly ValueProp[] = [
  {
    title: "Exact-span provenance",
    body: "Every finding maps back to a verbatim substring of the cached source — no unsourced paraphrase.",
  },
  {
    title: "Honest abstention",
    body: "When no confident match exists, it says so instead of forcing a wrong but confident answer.",
  },
  {
    title: "Deterministic numeric check",
    body: "The claimed effect size is compared against the trial's reported figure by rule, not vibes.",
  },
];

export function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
        Check whether your claim overstates the trial you cited
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-lg text-ink/60">
        Paste an efficacy claim and PaperTrail finds the primary source,
        extracts the actual finding, and flags where the two diverge — built for
        translational researchers who need the citation to hold up.
      </p>
      <dl className="mt-12 grid gap-8 text-left sm:grid-cols-3">
        {VALUE_PROPS.map((prop) => (
          <div key={prop.title}>
            <dt className="text-sm font-medium text-accent">{prop.title}</dt>
            <dd className="mt-2 text-sm text-ink/60">{prop.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

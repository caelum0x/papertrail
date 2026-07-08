import Link from "next/link";
import type { Tier } from "./types";

interface TierCardProps {
  tier: Tier;
}

export function TierCard({ tier }: TierCardProps) {
  return (
    <section
      className={`flex flex-col rounded-lg border bg-white p-6 ${
        tier.highlighted ? "border-accent" : "border-ink/10"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{tier.name}</h2>
        {tier.highlighted ? (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
            Popular
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-semibold">
        {tier.price}
        {tier.cadence ? (
          <span className="text-sm font-normal text-ink/60"> {tier.cadence}</span>
        ) : null}
      </p>
      <p className="mt-2 text-sm text-ink/60">{tier.tagline}</p>
      <ul className="mt-5 space-y-2 text-sm text-ink/80">
        {tier.features.map((feature) => (
          <li key={feature} className="flex gap-2">
            <span aria-hidden className="text-accent">
              ✓
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex-1" />
      <Link
        href="/about"
        className={`mt-4 inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium ${
          tier.highlighted
            ? "border-accent bg-accent text-white hover:opacity-90"
            : "border-ink/10 text-ink hover:bg-paper"
        }`}
      >
        {tier.cta}
      </Link>
    </section>
  );
}

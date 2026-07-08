import { TAXONOMY, type TaxonomyEntry } from "./aboutData";

function TaxonomyItem({ entry }: { entry: TaxonomyEntry }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <dt className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-ink">{entry.label}</span>
        <code className="rounded bg-ink/5 px-1 py-0.5 text-xs text-ink/60">{entry.type}</code>
      </dt>
      <dd className="mt-1.5 text-sm leading-relaxed text-ink/80">{entry.description}</dd>
    </div>
  );
}

export function DiscrepancyTaxonomy() {
  return (
    <dl className="space-y-4">
      {TAXONOMY.map((entry) => (
        <TaxonomyItem key={entry.type} entry={entry} />
      ))}
    </dl>
  );
}

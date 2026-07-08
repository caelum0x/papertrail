import type { Pillar } from "./types";

interface PillarSectionProps {
  pillar: Pillar;
}

export function PillarSection({ pillar }: PillarSectionProps) {
  return (
    <section id={pillar.id} className="mb-10 scroll-mt-20">
      <h2 className="text-lg font-semibold">{pillar.title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-ink/80">{pillar.body}</p>
      <ul className="mt-4 space-y-2 text-sm leading-relaxed text-ink/80">
        {pillar.points.map((point) => (
          <li key={point} className="flex gap-2">
            <span aria-hidden className="text-ink/30">
              —
            </span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

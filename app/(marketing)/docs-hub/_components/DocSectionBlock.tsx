import type { DocSection } from "./types";
import { DocCard } from "./DocCard";

interface DocSectionBlockProps {
  section: DocSection;
}

export function DocSectionBlock({ section }: DocSectionBlockProps) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-semibold">{section.heading}</h2>
      <div className="mt-4 space-y-3">
        {section.links.map((link) => (
          <DocCard key={link.title} link={link} />
        ))}
      </div>
    </section>
  );
}

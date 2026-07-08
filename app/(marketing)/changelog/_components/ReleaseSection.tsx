import type { Release } from "./types";
import { ChangeCard } from "./ChangeCard";

interface ReleaseSectionProps {
  release: Release;
}

export function ReleaseSection({ release }: ReleaseSectionProps) {
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-semibold">{release.version}</h2>
        <span className="text-sm text-ink/60">— {release.focus}</span>
      </div>
      <ul className="mt-4 space-y-3">
        {release.changes.map((change) => (
          <ChangeCard key={change.title} change={change} />
        ))}
      </ul>
    </section>
  );
}

import { TAG_STYLES, type ChangeEntry } from "./types";

interface ChangeCardProps {
  change: ChangeEntry;
}

export function ChangeCard({ change }: ChangeCardProps) {
  return (
    <li className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${TAG_STYLES[change.tag]}`}
        >
          {change.tag}
        </span>
        <h3 className="text-base font-semibold text-ink">{change.title}</h3>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink/80">
        {change.description}
      </p>
    </li>
  );
}

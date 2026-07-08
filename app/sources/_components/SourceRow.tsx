import Link from "next/link";
import { badgeFor, identifierLabel, type SourceItem } from "./sourceBadge";

interface SourceRowProps {
  item: SourceItem;
}

export function SourceRow({ item }: SourceRowProps) {
  const badge = badgeFor(item.source_type);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white p-3">
      <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${badge.classes}`}>
        {badge.label}
      </span>
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate text-sm text-ink/80 hover:text-accent hover:underline"
      >
        {item.title ?? "Untitled source"}
      </a>
      <span className="shrink-0 text-xs text-ink/50">
        {identifierLabel(item.source_type, item.external_id)}
      </span>
      <Link
        href={`/sources/${item.id}`}
        className="shrink-0 text-xs font-medium text-accent hover:underline"
      >
        View checks →
      </Link>
    </li>
  );
}

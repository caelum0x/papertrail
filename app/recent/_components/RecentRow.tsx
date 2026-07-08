import Link from "next/link";
import { LABELS, scoreClasses, type RecentItem } from "./recentShared";

interface RecentRowProps {
  item: RecentItem;
}

export function RecentRow({ item }: RecentRowProps) {
  return (
    <li>
      <Link
        href={`/v/${item.id}`}
        className="flex items-center gap-3 rounded-lg border border-ink/10 bg-white p-3 hover:bg-ink/5"
      >
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${scoreClasses(item.trust_score)}`}>
          {item.trust_score}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink/80">{item.claim_text}</span>
        <span className="shrink-0 text-xs text-ink/50">
          {LABELS[item.discrepancy_type] ?? item.discrepancy_type}
        </span>
      </Link>
    </li>
  );
}

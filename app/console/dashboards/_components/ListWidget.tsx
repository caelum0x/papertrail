import type { ListValue } from "./types";

interface ListWidgetProps {
  data: ListValue;
}

// Compact list of recent rows (claims, documents, verifications).
export function ListWidget({ data }: ListWidgetProps) {
  if (data.items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink/40">No items yet.</p>
    );
  }
  return (
    <ul className="divide-y divide-ink/10">
      {data.items.map((item) => (
        <li key={item.id} className="flex items-center justify-between gap-3 py-2">
          <span className="min-w-0 truncate text-sm text-ink/70" title={item.primary}>
            {item.primary}
          </span>
          {item.secondary ? (
            <span className="shrink-0 text-xs text-ink/40">{item.secondary}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

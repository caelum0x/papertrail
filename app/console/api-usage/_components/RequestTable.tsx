import type { ApiRequestLogItem } from "@/lib/apiusage/types";
import { RequestRow } from "./RequestRow";

// The request-log table body. Empty/loading/error states are handled by the
// caller via TableStates so this only renders when there are rows.
export function RequestTable({ items }: { items: ApiRequestLogItem[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Time</th>
          <th className="px-4 py-2 font-medium">Method</th>
          <th className="px-4 py-2 font-medium">Route</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 text-right font-medium">Duration</th>
          <th className="px-4 py-2 font-medium">Key</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink/10">
        {items.map((item) => (
          <RequestRow key={item.id} item={item} />
        ))}
      </tbody>
    </table>
  );
}

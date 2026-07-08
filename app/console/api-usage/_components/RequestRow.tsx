import type { ApiRequestLogItem } from "@/lib/apiusage/types";
import {
  formatDateTime,
  formatMs,
  keyLabel,
  statusColorClass,
} from "./shared";

// One row of the request log table.
export function RequestRow({ item }: { item: ApiRequestLogItem }) {
  return (
    <tr className="hover:bg-paper/60">
      <td className="px-4 py-2 text-ink/40">{formatDateTime(item.createdAt)}</td>
      <td className="px-4 py-2">
        <span className="rounded bg-ink/5 px-1.5 py-0.5 text-xs font-medium text-ink/60">
          {item.method}
        </span>
      </td>
      <td className="px-4 py-2">
        <code className="text-ink/80">{item.route}</code>
      </td>
      <td className="px-4 py-2">
        <span
          className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${statusColorClass(
            item.statusCode
          )}`}
        >
          {item.statusCode}
        </span>
      </td>
      <td className="px-4 py-2 text-right text-ink/60">
        {formatMs(item.durationMs)}
      </td>
      <td className="px-4 py-2 text-ink/60">
        {keyLabel(item.keyName, item.apiKeyId)}
      </td>
    </tr>
  );
}

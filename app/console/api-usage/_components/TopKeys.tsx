import type { KeyUsage } from "@/lib/apiusage/types";
import { EmptyState } from "./StateBlock";
import { formatDateTime, formatNumber, formatRate, keyLabel } from "./shared";

// Top-N API keys by request volume, with error rate and last-used time.
export function TopKeys({ keys }: { keys: KeyUsage[] }) {
  if (keys.length === 0) {
    return <EmptyState>No keyed traffic in this window.</EmptyState>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Key</th>
          <th className="px-4 py-2 text-right font-medium">Requests</th>
          <th className="px-4 py-2 text-right font-medium">Error rate</th>
          <th className="px-4 py-2 text-right font-medium">Last used</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink/10">
        {keys.map((k) => (
          <tr key={k.apiKeyId ?? "none"}>
            <td className="px-4 py-2 text-ink/80">
              {keyLabel(k.keyName, k.apiKeyId)}
            </td>
            <td className="px-4 py-2 text-right text-ink/60">
              {formatNumber(k.requests)}
            </td>
            <td
              className={
                k.errorRate >= 0.1
                  ? "px-4 py-2 text-right text-red-700"
                  : "px-4 py-2 text-right text-ink/60"
              }
            >
              {formatRate(k.errorRate)}
            </td>
            <td className="px-4 py-2 text-right text-ink/40">
              {formatDateTime(k.lastUsedAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

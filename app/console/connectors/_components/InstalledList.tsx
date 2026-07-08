import type { Connector } from "@/lib/connectors/types";
import { InstalledRow } from "./InstalledRow";

// The installed-connectors table body. Loading/empty/error states are handled by
// the caller via TableStates so this only renders when there are rows.
export function InstalledList({ connectors }: { connectors: Connector[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-ink/10 text-xs uppercase tracking-wide text-ink/40">
          <th className="px-4 py-2 font-medium">Name</th>
          <th className="px-4 py-2 font-medium">Provider</th>
          <th className="px-4 py-2 font-medium">Status</th>
          <th className="px-4 py-2 font-medium">Last sync</th>
          <th className="px-4 py-2 font-medium">Installed</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-ink/10">
        {connectors.map((c) => (
          <InstalledRow key={c.id} connector={c} />
        ))}
      </tbody>
    </table>
  );
}

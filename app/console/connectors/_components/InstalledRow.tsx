import Link from "next/link";
import type { Connector } from "@/lib/connectors/types";
import { formatDateTime, providerGlyph } from "./shared";
import { ConnectorStatusBadge } from "./StatusBadge";

// One row of the installed-connectors table.
export function InstalledRow({ connector }: { connector: Connector }) {
  return (
    <tr className="hover:bg-paper/60">
      <td className="px-4 py-2">
        <Link
          href={`/console/connectors/${connector.id}`}
          className="flex items-center gap-2 font-medium text-ink/80 hover:text-accent"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded bg-ink/5 text-xs font-semibold text-ink/60">
            {providerGlyph(connector.provider)}
          </span>
          {connector.name}
        </Link>
      </td>
      <td className="px-4 py-2 text-ink/60">{connector.provider}</td>
      <td className="px-4 py-2">
        <ConnectorStatusBadge status={connector.status} />
      </td>
      <td className="px-4 py-2 text-ink/60">
        {formatDateTime(connector.lastSyncAt ?? null)}
      </td>
      <td className="px-4 py-2 text-ink/40">
        {formatDateTime(connector.createdAt)}
      </td>
      <td className="px-4 py-2 text-right">
        <Link
          href={`/console/connectors/${connector.id}`}
          className="text-sm text-accent hover:underline"
        >
          Manage
        </Link>
      </td>
    </tr>
  );
}

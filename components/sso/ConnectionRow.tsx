import Link from "next/link";
import type { SsoConnection } from "@/lib/sso/types";
import { StatusBadge, VerifiedBadge } from "@/components/sso/StatusBadge";
import { PROTOCOL_LABELS } from "@/components/sso/fields";

// One row in the SSO connections list. Presentational: renders a connection's
// name, protocol, domain and status, and links to its detail page.

export function ConnectionRow({ connection }: { connection: SsoConnection }) {
  return (
    <li className="px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/console/settings/sso/${connection.id}`}
              className="text-sm text-ink/80 hover:text-accent truncate"
            >
              {connection.name}
            </Link>
            <span className="text-xs text-ink/40">
              {PROTOCOL_LABELS[connection.protocol] ?? connection.protocol}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-ink/40">
            {connection.domain ? (
              <span className="font-mono">{connection.domain}</span>
            ) : (
              <span>No domain set</span>
            )}
            <span>·</span>
            <span>
              Added {new Date(connection.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <VerifiedBadge verified={connection.verified} />
          <StatusBadge status={connection.status} />
        </div>
      </div>
    </li>
  );
}

"use client";

import Link from "next/link";
import type { Connector } from "@/lib/connectors/types";
import type { CatalogEntryView } from "./types";
import { ConnectorStatusBadge } from "./StatusBadge";
import { providerGlyph } from "./shared";

interface ConnectorHeaderProps {
  connector: Connector;
  entry: CatalogEntryView | null;
  canEdit: boolean;
  busy: boolean;
  onConnect: () => void;
  onSync: () => void;
  onTest: () => void;
  onDelete: () => void;
}

// Detail-page header: identity + status + lifecycle actions (connect / sync /
// test / delete), each gated by role and provider capabilities.
export function ConnectorHeader({
  connector,
  entry,
  canEdit,
  busy,
  onConnect,
  onSync,
  onTest,
  onDelete,
}: ConnectorHeaderProps) {
  const caps = entry?.capabilities;

  return (
    <div>
      <Link
        href="/console/connectors"
        className="text-sm text-accent hover:underline"
      >
        ← Back to connectors
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-ink/5 text-base font-semibold text-ink/70">
            {providerGlyph(connector.provider)}
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink/80">
              {connector.name}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-ink/40">
              <span>{entry?.name ?? connector.provider}</span>
              <ConnectorStatusBadge status={connector.status} />
            </div>
          </div>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {caps?.connect ? (
              <button
                onClick={onConnect}
                disabled={busy}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Connect
              </button>
            ) : null}
            {caps?.sync ? (
              <button
                onClick={onSync}
                disabled={busy}
                className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/80 disabled:opacity-40"
              >
                Sync now
              </button>
            ) : null}
            {caps?.test ? (
              <button
                onClick={onTest}
                disabled={busy}
                className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/80 disabled:opacity-40"
              >
                Send test
              </button>
            ) : null}
            <button
              onClick={onDelete}
              disabled={busy}
              className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700 disabled:opacity-40"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

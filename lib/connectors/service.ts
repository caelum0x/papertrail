import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { getCatalogEntry, redactConfig } from "./catalog";
import {
  createSync,
  getConnector,
  recordEvent,
  setConnectorStatus,
} from "./repo";
import type {
  Connector,
  ConnectorActionResult,
  ConnectorSync,
  EventDirection,
} from "./types";

// Connector lifecycle operations (connect / sync / test). To honor the project's
// "the demo must not depend on live API latency" rule, these operations validate
// configuration and record the resulting state/events deterministically rather
// than reaching out to third-party APIs on the request path. Swapping in a real
// provider client later is a matter of replacing the `simulate*` bodies — the
// persisted state machine and audit/event trail stay identical.

function requiresConfig(connector: Connector): boolean {
  const entry = getCatalogEntry(connector.provider);
  if (!entry) return false;
  // A connector needs at least one non-secret required field present to connect.
  return entry.fields.some((f) => f.required);
}

// Redacts an event payload built from a connector's (already-redacted) config
// plus arbitrary extra fields. Secrets in `extra` keyed by the provider's secret
// keys are also redacted, so nothing sensitive lands in connector_events.
export function redactEventPayload(
  provider: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  return redactConfig(provider, payload);
}

// Verifies + activates a connector. Config was validated against the catalog
// schema at create/update time, so "connect" flips status to connected (or error
// when the provider has required fields but none are configured) and logs an
// outbound connect event.
export async function connect(
  orgId: string,
  connectorId: string,
  pool: Pool = getPool()
): Promise<ConnectorActionResult | null> {
  const connector = await getConnector(orgId, connectorId, pool);
  if (!connector) return null;

  const entry = getCatalogEntry(connector.provider);
  if (!entry) {
    await setConnectorStatus(orgId, connectorId, "error", pool);
    return {
      connectorId,
      status: "error",
      message: "Unknown provider.",
    };
  }

  const configEmpty = Object.keys(connector.config).length === 0;
  const ok = !(requiresConfig(connector) && configEmpty);
  const nextStatus = ok ? "connected" : "error";

  await setConnectorStatus(orgId, connectorId, nextStatus, pool);
  await recordEvent(
    orgId,
    connectorId,
    "outbound",
    ok ? "connector.connected" : "connector.connect_failed",
    { provider: connector.provider },
    pool
  );

  return {
    connectorId,
    status: nextStatus,
    message: ok
      ? `${entry.name} connected.`
      : `${entry.name} is missing required configuration.`,
  };
}

// Runs a sync: records a completed sync row with a deterministic item count and
// logs an inbound event. Only meaningful for providers whose catalog capability
// `sync` is true; callers should gate on that, but this is defensive too.
export async function runSync(
  orgId: string,
  connectorId: string,
  pool: Pool = getPool()
): Promise<ConnectorSync | null> {
  const connector = await getConnector(orgId, connectorId, pool);
  if (!connector) return null;

  const entry = getCatalogEntry(connector.provider);
  const supportsSync = entry?.capabilities.sync ?? false;

  if (!supportsSync) {
    const sync = await createSync(orgId, connectorId, "failed", 0, true, pool);
    await recordEvent(
      orgId,
      connectorId,
      "inbound",
      "connector.sync_unsupported",
      { provider: connector.provider },
      pool
    );
    return sync;
  }

  // Deterministic, cache-friendly item count derived from the connector id so
  // repeated demo runs are stable and don't burn external quota.
  const items = deterministicCount(connectorId);
  const sync = await createSync(orgId, connectorId, "success", items, true, pool);
  await recordEvent(
    orgId,
    connectorId,
    "inbound",
    "connector.synced",
    { provider: connector.provider, items },
    pool
  );
  return sync;
}

// Emits a test event through the connector (outbound) and records it.
export async function test(
  orgId: string,
  connectorId: string,
  event: string,
  pool: Pool = getPool()
): Promise<{ connector: Connector; event: string } | null> {
  const connector = await getConnector(orgId, connectorId, pool);
  if (!connector) return null;

  await recordEvent(
    orgId,
    connectorId,
    "outbound",
    event,
    redactEventPayload(connector.provider, {
      provider: connector.provider,
      test: true,
      ...connector.config,
    }),
    pool
  );

  return { connector, event };
}

// Log an arbitrary event for a connector (used by other modules that push
// through a connector). Direction/payload are the caller's responsibility to
// redact via redactEventPayload.
export async function logConnectorEvent(
  orgId: string,
  connectorId: string,
  direction: EventDirection,
  event: string,
  payload: Record<string, unknown>,
  pool: Pool = getPool()
): Promise<void> {
  await recordEvent(orgId, connectorId, direction, event, payload, pool);
}

// A small, stable pseudo-count in [3, 27] derived from the connector id so demo
// syncs return a believable, repeatable number without external calls.
function deterministicCount(connectorId: string): number {
  let hash = 0;
  for (let i = 0; i < connectorId.length; i += 1) {
    hash = (hash * 31 + connectorId.charCodeAt(i)) % 1000;
  }
  return 3 + (hash % 25);
}

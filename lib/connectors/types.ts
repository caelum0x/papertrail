// Serializable shapes returned by the connectors API and consumed by the console
// pages. Kept free of `pg` / server-only imports so client components can import
// them safely. All timestamps are ISO strings; camelCase throughout.

export type ConnectorStatus =
  | "disconnected"
  | "connected"
  | "error"
  | "disabled";

export type SyncStatus = "running" | "success" | "failed";

export type EventDirection = "inbound" | "outbound";

export interface Connector {
  id: string;
  provider: string;
  name: string;
  // Config is returned with secret keys redacted (see redactConfig).
  config: Record<string, unknown>;
  status: ConnectorStatus;
  createdAt: string;
  // Convenience roll-ups for list rendering (may be absent on some queries).
  lastSyncAt?: string | null;
  lastSyncStatus?: SyncStatus | null;
}

export interface ConnectorSync {
  id: string;
  connectorId: string;
  status: SyncStatus;
  items: number;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
}

export interface ConnectorEvent {
  id: string;
  connectorId: string;
  direction: EventDirection;
  event: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// Result of POST /connect or POST /test — a lightweight outcome the UI surfaces.
export interface ConnectorActionResult {
  connectorId: string;
  status: ConnectorStatus;
  message: string;
}

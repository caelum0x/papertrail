import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { redactConfig } from "./catalog";
import type {
  Connector,
  ConnectorEvent,
  ConnectorStatus,
  ConnectorSync,
  EventDirection,
  SyncStatus,
} from "./types";

// Data access for the connectors module. Every query is org-scoped: org_id is
// always the first bound parameter (from the resolved Ctx.org, never client
// input) and all SQL is parameterized. Config is redacted on the way out so
// secrets never leave the server in a list/detail response.

function toIso(v: Date | string | null): string | null {
  if (v === null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

interface ConnectorRow {
  id: string;
  provider: string;
  name: string;
  config: Record<string, unknown> | null;
  status: string;
  created_at: Date | string;
  last_sync_at?: Date | string | null;
  last_sync_status?: string | null;
}

function mapConnector(row: ConnectorRow): Connector {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    config: redactConfig(row.provider, row.config ?? {}),
    status: row.status as ConnectorStatus,
    createdAt: toIso(row.created_at) as string,
    lastSyncAt:
      row.last_sync_at === undefined ? undefined : toIso(row.last_sync_at ?? null),
    lastSyncStatus:
      row.last_sync_status === undefined
        ? undefined
        : ((row.last_sync_status ?? null) as SyncStatus | null),
  };
}

export interface ConnectorFilters {
  provider?: string;
  status?: string;
}

interface CountRow {
  c: number;
}

function buildConnectorFilters(
  orgId: string,
  filters: ConnectorFilters
): { where: string; params: unknown[] } {
  const params: unknown[] = [orgId];
  const clauses = ["c.org_id = $1"];
  if (filters.provider) {
    params.push(filters.provider);
    clauses.push(`c.provider = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`c.status = $${params.length}`);
  }
  return { where: clauses.join(" and "), params };
}

// Newest-first, org-scoped list with a lateral join to each connector's most
// recent sync (for the last-sync column on the list page).
export async function listConnectors(
  orgId: string,
  filters: ConnectorFilters,
  limit: number,
  offset: number,
  pool: Pool = getPool()
): Promise<{ items: Connector[]; total: number }> {
  const { where, params } = buildConnectorFilters(orgId, filters);

  const countRes = await pool.query<CountRow>(
    `select count(*)::int as c from connectors c where ${where}`,
    params
  );
  const total = countRes.rows[0]?.c ?? 0;

  const listParams = [...params, limit, offset];
  const limitPos = listParams.length - 1;
  const offsetPos = listParams.length;

  const res = await pool.query<ConnectorRow>(
    `select
        c.id, c.provider, c.name, c.config, c.status, c.created_at,
        s.finished_at as last_sync_at, s.status as last_sync_status
       from connectors c
       left join lateral (
         select finished_at, status
           from connector_syncs s
          where s.org_id = c.org_id and s.connector_id = c.id
          order by s.created_at desc
          limit 1
       ) s on true
      where ${where}
      order by c.created_at desc
      limit $${limitPos} offset $${offsetPos}`,
    listParams
  );

  return { items: res.rows.map(mapConnector), total };
}

export async function getConnector(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<Connector | null> {
  const res = await pool.query<ConnectorRow>(
    `select
        c.id, c.provider, c.name, c.config, c.status, c.created_at,
        s.finished_at as last_sync_at, s.status as last_sync_status
       from connectors c
       left join lateral (
         select finished_at, status
           from connector_syncs s
          where s.org_id = c.org_id and s.connector_id = c.id
          order by s.created_at desc
          limit 1
       ) s on true
      where c.org_id = $1 and c.id = $2`,
    [orgId, id]
  );
  return res.rows.length > 0 ? mapConnector(res.rows[0]) : null;
}

export interface CreateConnectorArgs {
  orgId: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
}

export async function createConnector(
  args: CreateConnectorArgs,
  pool: Pool = getPool()
): Promise<Connector> {
  const res = await pool.query<ConnectorRow>(
    `insert into connectors (org_id, provider, name, config, status)
     values ($1, $2, $3, $4::jsonb, 'disconnected')
     returning id, provider, name, config, status, created_at`,
    [args.orgId, args.provider, args.name, JSON.stringify(args.config)]
  );
  return mapConnector(res.rows[0]);
}

export interface UpdateConnectorArgs {
  name?: string;
  config?: Record<string, unknown>;
  status?: ConnectorStatus;
}

// Partial update. Builds a dynamic SET list from provided fields only, always
// org-scoped. Returns null when the row doesn't belong to the org / doesn't exist.
export async function updateConnector(
  orgId: string,
  id: string,
  args: UpdateConnectorArgs,
  pool: Pool = getPool()
): Promise<Connector | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];

  if (args.name !== undefined) {
    params.push(args.name);
    sets.push(`name = $${params.length}`);
  }
  if (args.config !== undefined) {
    params.push(JSON.stringify(args.config));
    sets.push(`config = $${params.length}::jsonb`);
  }
  if (args.status !== undefined) {
    params.push(args.status);
    sets.push(`status = $${params.length}`);
  }

  if (sets.length === 0) {
    return getConnector(orgId, id, pool);
  }

  const res = await pool.query<ConnectorRow>(
    `update connectors set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, provider, name, config, status, created_at`,
    params
  );
  return res.rows.length > 0 ? mapConnector(res.rows[0]) : null;
}

export async function setConnectorStatus(
  orgId: string,
  id: string,
  status: ConnectorStatus,
  pool: Pool = getPool()
): Promise<Connector | null> {
  return updateConnector(orgId, id, { status }, pool);
}

export async function deleteConnector(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<boolean> {
  const res = await pool.query(
    `delete from connectors where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (res.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Syncs
// ---------------------------------------------------------------------------

interface SyncRow {
  id: string;
  connector_id: string;
  status: string;
  items: number;
  started_at: Date | string;
  finished_at: Date | string | null;
  created_at: Date | string;
}

function mapSync(row: SyncRow): ConnectorSync {
  return {
    id: row.id,
    connectorId: row.connector_id,
    status: row.status as SyncStatus,
    items: row.items,
    startedAt: toIso(row.started_at) as string,
    finishedAt: toIso(row.finished_at),
    createdAt: toIso(row.created_at) as string,
  };
}

export async function createSync(
  orgId: string,
  connectorId: string,
  status: SyncStatus,
  items: number,
  finished: boolean,
  pool: Pool = getPool()
): Promise<ConnectorSync> {
  const res = await pool.query<SyncRow>(
    `insert into connector_syncs (org_id, connector_id, status, items, finished_at)
     values ($1, $2, $3, $4, ${finished ? "now()" : "null"})
     returning id, connector_id, status, items, started_at, finished_at, created_at`,
    [orgId, connectorId, status, items]
  );
  return mapSync(res.rows[0]);
}

export async function listSyncs(
  orgId: string,
  connectorId: string,
  status: string | undefined,
  limit: number,
  offset: number,
  pool: Pool = getPool()
): Promise<{ items: ConnectorSync[]; total: number }> {
  const params: unknown[] = [orgId, connectorId];
  let where = "org_id = $1 and connector_id = $2";
  if (status) {
    params.push(status);
    where += ` and status = $${params.length}`;
  }

  const countRes = await pool.query<CountRow>(
    `select count(*)::int as c from connector_syncs where ${where}`,
    params
  );
  const total = countRes.rows[0]?.c ?? 0;

  const listParams = [...params, limit, offset];
  const res = await pool.query<SyncRow>(
    `select id, connector_id, status, items, started_at, finished_at, created_at
       from connector_syncs
      where ${where}
      order by created_at desc
      limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams
  );
  return { items: res.rows.map(mapSync), total };
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface EventRow {
  id: string;
  connector_id: string;
  direction: string;
  event: string;
  payload: Record<string, unknown> | null;
  created_at: Date | string;
}

function mapEvent(row: EventRow): ConnectorEvent {
  return {
    id: row.id,
    connectorId: row.connector_id,
    direction: row.direction as EventDirection,
    event: row.event,
    payload: row.payload ?? {},
    createdAt: toIso(row.created_at) as string,
  };
}

// Records an event. `payload` should already be redacted by the caller (see
// redactConfig / redactEventPayload) — this layer stores it verbatim.
export async function recordEvent(
  orgId: string,
  connectorId: string,
  direction: EventDirection,
  event: string,
  payload: Record<string, unknown>,
  pool: Pool = getPool()
): Promise<ConnectorEvent> {
  const res = await pool.query<EventRow>(
    `insert into connector_events (org_id, connector_id, direction, event, payload)
     values ($1, $2, $3, $4, $5::jsonb)
     returning id, connector_id, direction, event, payload, created_at`,
    [orgId, connectorId, direction, event, JSON.stringify(payload)]
  );
  return mapEvent(res.rows[0]);
}

export async function listEvents(
  orgId: string,
  connectorId: string,
  direction: string | undefined,
  limit: number,
  offset: number,
  pool: Pool = getPool()
): Promise<{ items: ConnectorEvent[]; total: number }> {
  const params: unknown[] = [orgId, connectorId];
  let where = "org_id = $1 and connector_id = $2";
  if (direction) {
    params.push(direction);
    where += ` and direction = $${params.length}`;
  }

  const countRes = await pool.query<CountRow>(
    `select count(*)::int as c from connector_events where ${where}`,
    params
  );
  const total = countRes.rows[0]?.c ?? 0;

  const listParams = [...params, limit, offset];
  const res = await pool.query<EventRow>(
    `select id, connector_id, direction, event, payload, created_at
       from connector_events
      where ${where}
      order by created_at desc
      limit $${listParams.length - 1} offset $${listParams.length}`,
    listParams
  );
  return { items: res.rows.map(mapEvent), total };
}

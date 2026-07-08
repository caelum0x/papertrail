import type { Pool } from "pg";
import { redactConfig } from "@/lib/integrations/registry";
import type {
  Integration,
  IntegrationStatus,
  IntegrationEvent,
  EventDirection,
  EventStatus,
} from "@/lib/integrations/types";

// Data access for integrations + integration_events. Every query is org-scoped:
// the caller passes ctx.org.id and it is always part of the WHERE clause so one
// org can never read or mutate another org's rows. Parameterized throughout.
//
// Config secrets never leave the server unmasked: the mapping functions used for
// API responses run config through redactConfig. getIntegrationRaw returns the
// unredacted config for internal use (test/dispatch) only.

interface IntegrationRow {
  id: string;
  provider: string;
  name: string;
  config: unknown;
  status: string;
  created_at: Date | string;
}

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// Maps a row to the API shape with secrets masked. Use for all responses.
function toIntegration(row: IntegrationRow): Integration {
  const config = toObject(row.config);
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    config: redactConfig(row.provider, config),
    status: row.status as IntegrationStatus,
    createdAt: toIso(row.created_at),
  };
}

export async function countIntegrations(
  pool: Pool,
  orgId: string
): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from integrations where org_id = $1`,
    [orgId]
  );
  return rows[0]?.n ?? 0;
}

export async function listIntegrations(
  pool: Pool,
  orgId: string,
  limit: number,
  offset: number
): Promise<Integration[]> {
  const { rows } = await pool.query<IntegrationRow>(
    `select id, provider, name, config, status, created_at
       from integrations
      where org_id = $1
      order by created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );
  return rows.map(toIntegration);
}

export async function getIntegration(
  pool: Pool,
  orgId: string,
  id: string
): Promise<Integration | null> {
  const { rows } = await pool.query<IntegrationRow>(
    `select id, provider, name, config, status, created_at
       from integrations
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows[0] ? toIntegration(rows[0]) : null;
}

// Returns the connector WITH its unredacted config, for internal use by the
// test/dispatch paths only. Never return this shape directly in an API response.
export async function getIntegrationRaw(
  pool: Pool,
  orgId: string,
  id: string
): Promise<{
  id: string;
  provider: string;
  name: string;
  status: IntegrationStatus;
  config: Record<string, unknown>;
} | null> {
  const { rows } = await pool.query<IntegrationRow>(
    `select id, provider, name, config, status
       from integrations
      where org_id = $1 and id = $2`,
    [orgId, id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    status: row.status as IntegrationStatus,
    config: toObject(row.config),
  };
}

export interface InsertIntegrationInput {
  orgId: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
}

export async function insertIntegration(
  pool: Pool,
  input: InsertIntegrationInput
): Promise<Integration> {
  const { rows } = await pool.query<IntegrationRow>(
    `insert into integrations (org_id, provider, name, config, status)
     values ($1, $2, $3, $4::jsonb, 'active')
     returning id, provider, name, config, status, created_at`,
    [input.orgId, input.provider, input.name, JSON.stringify(input.config)]
  );
  return toIntegration(rows[0]);
}

export interface UpdateIntegrationFields {
  name?: string;
  status?: IntegrationStatus;
  config?: Record<string, unknown>;
}

// Immutable-style partial update: only provided fields change. Returns the
// updated integration, or null if it doesn't exist in this org.
export async function updateIntegration(
  pool: Pool,
  orgId: string,
  id: string,
  fields: UpdateIntegrationFields
): Promise<Integration | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];
  let i = 3;

  if (fields.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(fields.name);
  }
  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(fields.status);
  }
  if (fields.config !== undefined) {
    sets.push(`config = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.config));
  }

  if (sets.length === 0) {
    return getIntegration(pool, orgId, id);
  }

  const { rows } = await pool.query<IntegrationRow>(
    `update integrations set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, provider, name, config, status, created_at`,
    params
  );
  return rows[0] ? toIntegration(rows[0]) : null;
}

// Hard-deletes a connector (events cascade). Returns the deleted integration or
// null if it didn't exist in this org.
export async function deleteIntegration(
  pool: Pool,
  orgId: string,
  id: string
): Promise<Integration | null> {
  const { rows } = await pool.query<IntegrationRow>(
    `delete from integrations
      where org_id = $1 and id = $2
      returning id, provider, name, config, status, created_at`,
    [orgId, id]
  );
  return rows[0] ? toIntegration(rows[0]) : null;
}

// --- Events ---------------------------------------------------------------

interface EventRow {
  id: string;
  integration_id: string;
  direction: string;
  event: string;
  payload: unknown;
  status: string;
  created_at: Date | string;
}

function toEvent(row: EventRow): IntegrationEvent {
  return {
    id: row.id,
    integrationId: row.integration_id,
    direction: row.direction as EventDirection,
    event: row.event,
    payload: toObject(row.payload),
    status: row.status as EventStatus,
    createdAt: toIso(row.created_at),
  };
}

export interface RecordEventInput {
  orgId: string;
  integrationId: string;
  direction: EventDirection;
  event: string;
  payload: Record<string, unknown>;
  status: EventStatus;
}

// Records one integration event. Best-effort: a logging failure must never sink
// the operation it is recording.
export async function recordEvent(
  pool: Pool,
  input: RecordEventInput
): Promise<void> {
  try {
    await pool.query(
      `insert into integration_events
         (org_id, integration_id, direction, event, payload, status)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        input.orgId,
        input.integrationId,
        input.direction,
        input.event,
        JSON.stringify(input.payload ?? {}),
        input.status,
      ]
    );
  } catch {
    // Event logging is best-effort and must not fail the originating action.
  }
}

export async function countEvents(
  pool: Pool,
  orgId: string,
  integrationId: string
): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n
       from integration_events
      where org_id = $1 and integration_id = $2`,
    [orgId, integrationId]
  );
  return rows[0]?.n ?? 0;
}

export async function listEvents(
  pool: Pool,
  orgId: string,
  integrationId: string,
  limit: number,
  offset: number
): Promise<IntegrationEvent[]> {
  const { rows } = await pool.query<EventRow>(
    `select id, integration_id, direction, event, payload, status, created_at
       from integration_events
      where org_id = $1 and integration_id = $2
      order by created_at desc
      limit $3 offset $4`,
    [orgId, integrationId, limit, offset]
  );
  return rows.map(toEvent);
}

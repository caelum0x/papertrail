import { getPool } from "@/lib/db";
import type {
  Monitor,
  MonitorHit,
  MonitorSourceType,
  MonitorFrequency,
  MonitorHitStatus,
  AeSignal,
  AeSeverity,
  AeStatus,
} from "@/lib/monitoring/types";
import type {
  CreateMonitorInput,
  UpdateMonitorInput,
  CreateAeSignalInput,
  UpdateAeSignalInput,
} from "@/lib/monitoring/schemas";

// Repository for the monitoring tables. Every query is org-scoped: the caller
// passes ctx.org.id and all reads/writes filter by it so tenants never see each
// other's data. Parameterized queries only — never interpolate user input.

const DEFAULT_SOURCES: MonitorSourceType[] = ["pubmed", "clinicaltrials"];

// ---------- monitors ----------

const MONITOR_COLUMNS = `id, org_id, project_id, name, query, sources,
  frequency, enabled, last_run_at, created_at`;

interface MonitorRow {
  id: string;
  org_id: string;
  project_id: string | null;
  name: string;
  query: string;
  sources: unknown;
  frequency: MonitorFrequency;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
}

function normalizeSources(raw: unknown): MonitorSourceType[] {
  if (Array.isArray(raw)) {
    const valid = raw.filter(
      (s): s is MonitorSourceType =>
        s === "pubmed" || s === "clinicaltrials"
    );
    if (valid.length > 0) {
      return Array.from(new Set(valid));
    }
  }
  return [...DEFAULT_SOURCES];
}

function mapMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    name: row.name,
    query: row.query,
    sources: normalizeSources(row.sources),
    frequency: row.frequency,
    enabled: row.enabled,
    last_run_at: row.last_run_at,
    created_at: row.created_at,
  };
}

export interface ListMonitorsParams {
  orgId: string;
  limit: number;
  offset: number;
  projectId?: string;
  enabled?: boolean;
}

export interface ListMonitorsResult {
  items: Monitor[];
  total: number;
}

interface CountRow {
  count: string;
}

export async function listMonitors(
  params: ListMonitorsParams
): Promise<ListMonitorsResult> {
  const pool = getPool();
  const conditions: string[] = ["org_id = $1"];
  const values: unknown[] = [params.orgId];

  if (params.projectId) {
    values.push(params.projectId);
    conditions.push(`project_id = $${values.length}`);
  }
  if (params.enabled !== undefined) {
    values.push(params.enabled);
    conditions.push(`enabled = $${values.length}`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const listValues = [...values, params.limit, params.offset];
  const limitIdx = `$${values.length + 1}`;
  const offsetIdx = `$${values.length + 2}`;

  const [itemsResult, countResult] = await Promise.all([
    pool.query<MonitorRow>(
      `SELECT ${MONITOR_COLUMNS}
       FROM monitors
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      listValues
    ),
    pool.query<CountRow>(
      `SELECT count(*) AS count FROM monitors ${whereClause}`,
      values
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapMonitor),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function getMonitorById(
  orgId: string,
  id: string
): Promise<Monitor | null> {
  const { rows } = await getPool().query<MonitorRow>(
    `SELECT ${MONITOR_COLUMNS} FROM monitors WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
  const row = rows[0];
  return row ? mapMonitor(row) : null;
}

export interface CreateMonitorParams extends CreateMonitorInput {
  orgId: string;
}

export async function createMonitor(
  params: CreateMonitorParams
): Promise<Monitor> {
  const sources = params.sources ?? [...DEFAULT_SOURCES];
  const { rows } = await getPool().query<MonitorRow>(
    `INSERT INTO monitors
       (org_id, project_id, name, query, sources, frequency, enabled)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING ${MONITOR_COLUMNS}`,
    [
      params.orgId,
      params.project_id ?? null,
      params.name,
      params.query,
      JSON.stringify(sources),
      params.frequency ?? "weekly",
      params.enabled ?? true,
    ]
  );
  return mapMonitor(rows[0]);
}

export async function updateMonitor(
  orgId: string,
  id: string,
  patch: UpdateMonitorInput
): Promise<Monitor | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  const push = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };

  if ("project_id" in patch) push("project_id", patch.project_id ?? null);
  if (patch.name !== undefined) push("name", patch.name);
  if (patch.query !== undefined) push("query", patch.query);
  if (patch.sources !== undefined) {
    push("sources", JSON.stringify(patch.sources), "::jsonb");
  }
  if (patch.frequency !== undefined) push("frequency", patch.frequency);
  if (patch.enabled !== undefined) push("enabled", patch.enabled);

  if (sets.length === 0) {
    return getMonitorById(orgId, id);
  }

  values.push(orgId, id);
  const orgIdx = `$${values.length - 1}`;
  const idIdx = `$${values.length}`;

  const { rows } = await getPool().query<MonitorRow>(
    `UPDATE monitors SET ${sets.join(", ")}
     WHERE org_id = ${orgIdx} AND id = ${idIdx}
     RETURNING ${MONITOR_COLUMNS}`,
    values
  );
  const row = rows[0];
  return row ? mapMonitor(row) : null;
}

export async function deleteMonitor(
  orgId: string,
  id: string
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM monitors WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
  return (rowCount ?? 0) > 0;
}

export async function touchMonitorRun(
  orgId: string,
  id: string
): Promise<void> {
  await getPool().query(
    `UPDATE monitors SET last_run_at = now() WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
}

// ---------- monitor_hits ----------

const HIT_COLUMNS = `id, org_id, monitor_id, source_type, external_id,
  title, url, matched_at, status, created_at`;

interface HitRow {
  id: string;
  org_id: string;
  monitor_id: string;
  source_type: MonitorSourceType;
  external_id: string;
  title: string | null;
  url: string | null;
  matched_at: string;
  status: MonitorHitStatus;
  created_at: string;
}

function mapHit(row: HitRow): MonitorHit {
  return {
    id: row.id,
    org_id: row.org_id,
    monitor_id: row.monitor_id,
    source_type: row.source_type,
    external_id: row.external_id,
    title: row.title,
    url: row.url,
    matched_at: row.matched_at,
    status: row.status,
    created_at: row.created_at,
  };
}

export interface ListHitsParams {
  orgId: string;
  monitorId: string;
  limit: number;
  offset: number;
  status?: MonitorHitStatus;
}

export interface ListHitsResult {
  items: MonitorHit[];
  total: number;
}

export async function listHits(
  params: ListHitsParams
): Promise<ListHitsResult> {
  const pool = getPool();
  const conditions: string[] = ["org_id = $1", "monitor_id = $2"];
  const values: unknown[] = [params.orgId, params.monitorId];

  if (params.status) {
    values.push(params.status);
    conditions.push(`status = $${values.length}`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const listValues = [...values, params.limit, params.offset];
  const limitIdx = `$${values.length + 1}`;
  const offsetIdx = `$${values.length + 2}`;

  const [itemsResult, countResult] = await Promise.all([
    pool.query<HitRow>(
      `SELECT ${HIT_COLUMNS}
       FROM monitor_hits
       ${whereClause}
       ORDER BY matched_at DESC
       LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      listValues
    ),
    pool.query<CountRow>(
      `SELECT count(*) AS count FROM monitor_hits ${whereClause}`,
      values
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapHit),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function getHitById(
  orgId: string,
  id: string
): Promise<MonitorHit | null> {
  const { rows } = await getPool().query<HitRow>(
    `SELECT ${HIT_COLUMNS} FROM monitor_hits WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
  const row = rows[0];
  return row ? mapHit(row) : null;
}

export interface UpsertHitParams {
  orgId: string;
  monitorId: string;
  sourceType: MonitorSourceType;
  externalId: string;
  title: string | null;
  url: string | null;
}

// Records a hit for a monitor run. Deduped on (monitor_id, source_type,
// external_id) so re-running a monitor never creates duplicate rows; returns
// true only when a new hit was inserted.
export async function upsertHit(params: UpsertHitParams): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `INSERT INTO monitor_hits
       (org_id, monitor_id, source_type, external_id, title, url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (monitor_id, source_type, external_id) DO NOTHING`,
    [
      params.orgId,
      params.monitorId,
      params.sourceType,
      params.externalId,
      params.title,
      params.url,
    ]
  );
  return (rowCount ?? 0) > 0;
}

export async function updateHitStatus(
  orgId: string,
  id: string,
  status: MonitorHitStatus
): Promise<MonitorHit | null> {
  const { rows } = await getPool().query<HitRow>(
    `UPDATE monitor_hits SET status = $3
     WHERE org_id = $1 AND id = $2
     RETURNING ${HIT_COLUMNS}`,
    [orgId, id, status]
  );
  const row = rows[0];
  return row ? mapHit(row) : null;
}

// ---------- ae_signals ----------

const SIGNAL_COLUMNS = `id, org_id, drug, event, severity, status, notes, created_at`;

interface SignalRow {
  id: string;
  org_id: string;
  drug: string;
  event: string;
  severity: AeSeverity;
  status: AeStatus;
  notes: string | null;
  created_at: string;
}

function mapSignal(row: SignalRow): AeSignal {
  return {
    id: row.id,
    org_id: row.org_id,
    drug: row.drug,
    event: row.event,
    severity: row.severity,
    status: row.status,
    notes: row.notes,
    created_at: row.created_at,
  };
}

export interface ListSignalsParams {
  orgId: string;
  limit: number;
  offset: number;
  status?: AeStatus;
  severity?: AeSeverity;
  drug?: string;
}

export interface ListSignalsResult {
  items: AeSignal[];
  total: number;
}

export async function listSignals(
  params: ListSignalsParams
): Promise<ListSignalsResult> {
  const pool = getPool();
  const conditions: string[] = ["org_id = $1"];
  const values: unknown[] = [params.orgId];

  if (params.status) {
    values.push(params.status);
    conditions.push(`status = $${values.length}`);
  }
  if (params.severity) {
    values.push(params.severity);
    conditions.push(`severity = $${values.length}`);
  }
  if (params.drug) {
    values.push(`%${params.drug}%`);
    conditions.push(`drug ILIKE $${values.length}`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const listValues = [...values, params.limit, params.offset];
  const limitIdx = `$${values.length + 1}`;
  const offsetIdx = `$${values.length + 2}`;

  const [itemsResult, countResult] = await Promise.all([
    pool.query<SignalRow>(
      `SELECT ${SIGNAL_COLUMNS}
       FROM ae_signals
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
      listValues
    ),
    pool.query<CountRow>(
      `SELECT count(*) AS count FROM ae_signals ${whereClause}`,
      values
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapSignal),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function getSignalById(
  orgId: string,
  id: string
): Promise<AeSignal | null> {
  const { rows } = await getPool().query<SignalRow>(
    `SELECT ${SIGNAL_COLUMNS} FROM ae_signals WHERE org_id = $1 AND id = $2`,
    [orgId, id]
  );
  const row = rows[0];
  return row ? mapSignal(row) : null;
}

export interface CreateSignalParams extends CreateAeSignalInput {
  orgId: string;
}

export async function createSignal(
  params: CreateSignalParams
): Promise<AeSignal> {
  const { rows } = await getPool().query<SignalRow>(
    `INSERT INTO ae_signals (org_id, drug, event, severity, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${SIGNAL_COLUMNS}`,
    [
      params.orgId,
      params.drug,
      params.event,
      params.severity ?? "moderate",
      params.status ?? "open",
      params.notes ?? null,
    ]
  );
  return mapSignal(rows[0]);
}

export async function updateSignal(
  orgId: string,
  id: string,
  patch: UpdateAeSignalInput
): Promise<AeSignal | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  const push = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.drug !== undefined) push("drug", patch.drug);
  if (patch.event !== undefined) push("event", patch.event);
  if (patch.severity !== undefined) push("severity", patch.severity);
  if (patch.status !== undefined) push("status", patch.status);
  if ("notes" in patch) push("notes", patch.notes ?? null);

  if (sets.length === 0) {
    return getSignalById(orgId, id);
  }

  values.push(orgId, id);
  const orgIdx = `$${values.length - 1}`;
  const idIdx = `$${values.length}`;

  const { rows } = await getPool().query<SignalRow>(
    `UPDATE ae_signals SET ${sets.join(", ")}
     WHERE org_id = ${orgIdx} AND id = ${idIdx}
     RETURNING ${SIGNAL_COLUMNS}`,
    values
  );
  const row = rows[0];
  return row ? mapSignal(row) : null;
}

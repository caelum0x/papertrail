import type { Pool } from "pg";
import { z } from "zod";
import { getPool } from "@/lib/db";

// Data access + validation for the dashboard builder (migration 0041). Colocated
// with the dashboard routes so the module owns its persistence. Every query binds
// org_id as a parameter — a tenant can never read, mutate, or resolve data for
// another org's dashboard or widget.

// ---------------------------------------------------------------------------
// Metric vocabulary — the org-scoped values a widget can render. Kept small and
// bounded so a widget config can never ask the resolver for arbitrary SQL.
// ---------------------------------------------------------------------------

export const METRIC_KEYS = [
  "claims_verified",
  "total_verifications",
  "documents_processed",
  "avg_trust_score",
  "distortion_rate",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const LIST_SOURCES = [
  "recent_claims",
  "recent_documents",
  "recent_verifications",
] as const;

export type ListSource = (typeof LIST_SOURCES)[number];

export const CHART_SERIES = [
  "verifications_over_time",
  "distortion_by_type",
  "trust_distribution",
] as const;

export type ChartSeries = (typeof CHART_SERIES)[number];

export const WIDGET_KINDS = ["metric", "list", "chart"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

// ---------------------------------------------------------------------------
// Zod schemas — never trust raw client JSON into jsonb columns.
// ---------------------------------------------------------------------------

export const layoutSchema = z
  .object({
    columns: z.number().int().min(1).max(12).default(3),
    gap: z.number().int().min(0).max(48).default(16),
  })
  .default({ columns: 3, gap: 16 });

export type DashboardLayout = z.infer<typeof layoutSchema>;

export const positionSchema = z
  .object({
    x: z.number().int().min(0).max(48).default(0),
    y: z.number().int().min(0).max(999).default(0),
    w: z.number().int().min(1).max(12).default(1),
    h: z.number().int().min(1).max(12).default(1),
  })
  .default({ x: 0, y: 0, w: 1, h: 1 });

export type WidgetPosition = z.infer<typeof positionSchema>;

// Each widget kind constrains its own config. A discriminated shape keeps the
// resolver honest: a `metric` widget must name a known MetricKey, etc.
export const widgetConfigSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    metric: z.enum(METRIC_KEYS).optional(),
    source: z.enum(LIST_SOURCES).optional(),
    series: z.enum(CHART_SERIES).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    rangeDays: z.number().int().min(1).max(365).optional(),
  })
  .default({});

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

export const createDashboardSchema = z.object({
  name: z.string().trim().min(1, "Dashboard name is required.").max(120),
  layout: layoutSchema.optional(),
  isDefault: z.boolean().optional(),
});

export type CreateDashboardInput = z.infer<typeof createDashboardSchema>;

export const updateDashboardSchema = z
  .object({
    name: z.string().trim().min(1, "Dashboard name is required.").max(120).optional(),
    layout: layoutSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.layout !== undefined || v.isDefault !== undefined,
    { message: "No fields to update." }
  );

export type UpdateDashboardInput = z.infer<typeof updateDashboardSchema>;

export const createWidgetSchema = z.object({
  kind: z.enum(WIDGET_KINDS),
  config: widgetConfigSchema.optional(),
  position: positionSchema.optional(),
});

export type CreateWidgetInput = z.infer<typeof createWidgetSchema>;

export const updateWidgetSchema = z
  .object({
    config: widgetConfigSchema.optional(),
    position: positionSchema.optional(),
  })
  .refine((v) => v.config !== undefined || v.position !== undefined, {
    message: "No fields to update.",
  });

export type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;

// ---------------------------------------------------------------------------
// Row types + mappers
// ---------------------------------------------------------------------------

export interface Dashboard {
  id: string;
  org_id: string;
  name: string;
  layout: DashboardLayout;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  created_by_name: string | null;
  created_by_email: string | null;
  widget_count: number;
}

export interface DashboardWidget {
  id: string;
  org_id: string;
  dashboard_id: string;
  kind: WidgetKind;
  config: WidgetConfig;
  position: WidgetPosition;
  created_at: string;
}

interface DashboardRow {
  id: string;
  org_id: string;
  name: string;
  layout: unknown;
  is_default: boolean;
  created_by: string | null;
  created_at: Date | string;
  created_by_name: string | null;
  created_by_email: string | null;
  widget_count: number | string | null;
}

interface WidgetRow {
  id: string;
  org_id: string;
  dashboard_id: string;
  kind: string;
  config: unknown;
  position: unknown;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapDashboard(row: DashboardRow): Dashboard {
  const layout = layoutSchema.safeParse(row.layout);
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    layout: layout.success ? layout.data : { columns: 3, gap: 16 },
    is_default: row.is_default,
    created_by: row.created_by,
    created_at: toIso(row.created_at),
    created_by_name: row.created_by_name,
    created_by_email: row.created_by_email,
    widget_count: Number(row.widget_count ?? 0),
  };
}

function mapWidget(row: WidgetRow): DashboardWidget {
  const config = widgetConfigSchema.safeParse(row.config);
  const position = positionSchema.safeParse(row.position);
  return {
    id: row.id,
    org_id: row.org_id,
    dashboard_id: row.dashboard_id,
    kind: (WIDGET_KINDS as readonly string[]).includes(row.kind)
      ? (row.kind as WidgetKind)
      : "metric",
    config: config.success ? config.data : {},
    position: position.success ? position.data : { x: 0, y: 0, w: 1, h: 1 },
    created_at: toIso(row.created_at),
  };
}

const DASHBOARD_COLUMNS = `
  d.id, d.org_id, d.name, d.layout, d.is_default, d.created_by, d.created_at,
  u.name as created_by_name, u.email as created_by_email,
  (select count(*)::int from dashboard_widgets w where w.dashboard_id = d.id) as widget_count
`;

// ---------------------------------------------------------------------------
// Dashboard CRUD
// ---------------------------------------------------------------------------

export async function listDashboards(
  orgId: string,
  limit: number,
  offset: number,
  pool: Pool = getPool()
): Promise<{ items: Dashboard[]; total: number }> {
  const countResult = await pool.query<{ count: string }>(
    `select count(*)::int as count from dashboards where org_id = $1`,
    [orgId]
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const { rows } = await pool.query<DashboardRow>(
    `select ${DASHBOARD_COLUMNS}
       from dashboards d
       left join users u on u.id = d.created_by
      where d.org_id = $1
      order by d.is_default desc, d.created_at desc
      limit $2 offset $3`,
    [orgId, limit, offset]
  );

  return { items: rows.map(mapDashboard), total };
}

export async function getDashboard(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<Dashboard | null> {
  const { rows } = await pool.query<DashboardRow>(
    `select ${DASHBOARD_COLUMNS}
       from dashboards d
       left join users u on u.id = d.created_by
      where d.org_id = $1 and d.id = $2`,
    [orgId, id]
  );
  return rows[0] ? mapDashboard(rows[0]) : null;
}

interface CreateDashboardParams extends CreateDashboardInput {
  orgId: string;
  createdBy: string | null;
}

export async function createDashboard(
  params: CreateDashboardParams,
  pool: Pool = getPool()
): Promise<Dashboard> {
  const { orgId, createdBy, name } = params;
  const layout = params.layout ?? { columns: 3, gap: 16 };
  const isDefault = params.isDefault ?? false;

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Making this the default clears any prior default so the partial unique
    // index (one default per org) is never violated.
    if (isDefault) {
      await client.query(
        `update dashboards set is_default = false where org_id = $1 and is_default`,
        [orgId]
      );
    }
    const { rows } = await client.query<{ id: string }>(
      `insert into dashboards (org_id, name, layout, is_default, created_by)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [orgId, name, JSON.stringify(layout), isDefault, createdBy]
    );
    await client.query("commit");
    const created = await getDashboard(orgId, rows[0].id, pool);
    if (!created) {
      throw new Error("Dashboard vanished immediately after creation.");
    }
    return created;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function updateDashboard(
  orgId: string,
  id: string,
  input: UpdateDashboardInput,
  pool: Pool = getPool()
): Promise<Dashboard | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const existing = await client.query<{ id: string }>(
      `select id from dashboards where org_id = $1 and id = $2 for update`,
      [orgId, id]
    );
    if (existing.rows.length === 0) {
      await client.query("rollback");
      return null;
    }

    if (input.isDefault === true) {
      await client.query(
        `update dashboards set is_default = false
          where org_id = $1 and is_default and id <> $2`,
        [orgId, id]
      );
    }

    const sets: string[] = [];
    const values: unknown[] = [orgId, id];
    let n = 3;
    if (input.name !== undefined) {
      sets.push(`name = $${n++}`);
      values.push(input.name);
    }
    if (input.layout !== undefined) {
      sets.push(`layout = $${n++}`);
      values.push(JSON.stringify(input.layout));
    }
    if (input.isDefault !== undefined) {
      sets.push(`is_default = $${n++}`);
      values.push(input.isDefault);
    }

    if (sets.length > 0) {
      await client.query(
        `update dashboards set ${sets.join(", ")} where org_id = $1 and id = $2`,
        values
      );
    }
    await client.query("commit");
    return getDashboard(orgId, id, pool);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteDashboard(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<boolean> {
  const result = await pool.query(
    `delete from dashboards where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Widget CRUD (always scoped to a dashboard the org owns)
// ---------------------------------------------------------------------------

export async function listWidgets(
  orgId: string,
  dashboardId: string,
  pool: Pool = getPool()
): Promise<DashboardWidget[]> {
  const { rows } = await pool.query<WidgetRow>(
    `select id, org_id, dashboard_id, kind, config, position, created_at
       from dashboard_widgets
      where org_id = $1 and dashboard_id = $2
      order by created_at asc`,
    [orgId, dashboardId]
  );
  return rows.map(mapWidget);
}

export async function getWidget(
  orgId: string,
  dashboardId: string,
  widgetId: string,
  pool: Pool = getPool()
): Promise<DashboardWidget | null> {
  const { rows } = await pool.query<WidgetRow>(
    `select id, org_id, dashboard_id, kind, config, position, created_at
       from dashboard_widgets
      where org_id = $1 and dashboard_id = $2 and id = $3`,
    [orgId, dashboardId, widgetId]
  );
  return rows[0] ? mapWidget(rows[0]) : null;
}

export async function createWidget(
  orgId: string,
  dashboardId: string,
  input: CreateWidgetInput,
  pool: Pool = getPool()
): Promise<DashboardWidget> {
  const config = input.config ?? {};
  const position = input.position ?? { x: 0, y: 0, w: 1, h: 1 };
  const { rows } = await pool.query<{ id: string }>(
    `insert into dashboard_widgets (org_id, dashboard_id, kind, config, position)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [
      orgId,
      dashboardId,
      input.kind,
      JSON.stringify(config),
      JSON.stringify(position),
    ]
  );
  const created = await getWidget(orgId, dashboardId, rows[0].id, pool);
  if (!created) {
    throw new Error("Widget vanished immediately after creation.");
  }
  return created;
}

export async function updateWidget(
  orgId: string,
  dashboardId: string,
  widgetId: string,
  input: UpdateWidgetInput,
  pool: Pool = getPool()
): Promise<DashboardWidget | null> {
  const sets: string[] = [];
  const values: unknown[] = [orgId, dashboardId, widgetId];
  let n = 4;
  if (input.config !== undefined) {
    sets.push(`config = $${n++}`);
    values.push(JSON.stringify(input.config));
  }
  if (input.position !== undefined) {
    sets.push(`position = $${n++}`);
    values.push(JSON.stringify(input.position));
  }
  if (sets.length === 0) {
    return getWidget(orgId, dashboardId, widgetId, pool);
  }
  const result = await pool.query(
    `update dashboard_widgets set ${sets.join(", ")}
      where org_id = $1 and dashboard_id = $2 and id = $3`,
    values
  );
  if ((result.rowCount ?? 0) === 0) {
    return null;
  }
  return getWidget(orgId, dashboardId, widgetId, pool);
}

export async function deleteWidget(
  orgId: string,
  dashboardId: string,
  widgetId: string,
  pool: Pool = getPool()
): Promise<boolean> {
  const result = await pool.query(
    `delete from dashboard_widgets
      where org_id = $1 and dashboard_id = $2 and id = $3`,
    [orgId, dashboardId, widgetId]
  );
  return (result.rowCount ?? 0) > 0;
}

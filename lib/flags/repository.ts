import type { Pool } from "pg";
import type {
  Experiment,
  ExperimentStatus,
  ExperimentVariant,
  FeatureFlag,
  FlagRule,
} from "@/lib/flags/types";

// Data access for feature flags & experiments. Every method is org-scoped:
// org_id is always the first predicate so a caller can never read or mutate
// another tenant's rows.

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

interface FlagRow {
  id: string;
  org_id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rollout_percent: number;
  rules: unknown;
  created_at: Date | string;
}

function mapFlag(row: FlagRow): FeatureFlag {
  return {
    id: row.id,
    orgId: row.org_id,
    key: row.key,
    description: row.description,
    enabled: row.enabled,
    rolloutPercent: row.rollout_percent,
    rules: (Array.isArray(row.rules) ? row.rules : []) as FlagRule[],
    createdAt: toIso(row.created_at),
  };
}

export async function listFlags(
  pool: Pool,
  params: { orgId: string; q?: string; limit: number; offset: number }
): Promise<{ items: FeatureFlag[]; total: number }> {
  const values: unknown[] = [params.orgId];
  let where = "org_id = $1";
  if (params.q) {
    values.push(`%${params.q.toLowerCase()}%`);
    where += ` and (lower(key) like $${values.length} or lower(coalesce(description, '')) like $${values.length})`;
  }

  const countRes = await pool.query(
    `select count(*)::int as total from feature_flags where ${where}`,
    values
  );
  const total = countRes.rows[0]?.total ?? 0;

  const pageValues = [...values, params.limit, params.offset];
  const { rows } = await pool.query(
    `select id, org_id, key, description, enabled, rollout_percent, rules, created_at
       from feature_flags
      where ${where}
      order by created_at desc
      limit $${pageValues.length - 1} offset $${pageValues.length}`,
    pageValues
  );
  return { items: rows.map(mapFlag), total };
}

export async function getFlagById(
  pool: Pool,
  orgId: string,
  id: string
): Promise<FeatureFlag | null> {
  const { rows } = await pool.query(
    `select id, org_id, key, description, enabled, rollout_percent, rules, created_at
       from feature_flags where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows.length ? mapFlag(rows[0]) : null;
}

export async function getFlagByKey(
  pool: Pool,
  orgId: string,
  key: string
): Promise<FeatureFlag | null> {
  const { rows } = await pool.query(
    `select id, org_id, key, description, enabled, rollout_percent, rules, created_at
       from feature_flags where org_id = $1 and lower(key) = lower($2)`,
    [orgId, key]
  );
  return rows.length ? mapFlag(rows[0]) : null;
}

export async function createFlag(
  pool: Pool,
  params: {
    orgId: string;
    key: string;
    description: string | null;
    enabled: boolean;
    rolloutPercent: number;
    rules: FlagRule[];
  }
): Promise<FeatureFlag> {
  const { rows } = await pool.query(
    `insert into feature_flags (org_id, key, description, enabled, rollout_percent, rules)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning id, org_id, key, description, enabled, rollout_percent, rules, created_at`,
    [
      params.orgId,
      params.key,
      params.description,
      params.enabled,
      params.rolloutPercent,
      JSON.stringify(params.rules),
    ]
  );
  return mapFlag(rows[0]);
}

export async function updateFlag(
  pool: Pool,
  orgId: string,
  id: string,
  patch: {
    description?: string | null;
    enabled?: boolean;
    rolloutPercent?: number;
    rules?: FlagRule[];
  }
): Promise<FeatureFlag | null> {
  const sets: string[] = [];
  const values: unknown[] = [orgId, id];

  if (patch.description !== undefined) {
    values.push(patch.description);
    sets.push(`description = $${values.length}`);
  }
  if (patch.enabled !== undefined) {
    values.push(patch.enabled);
    sets.push(`enabled = $${values.length}`);
  }
  if (patch.rolloutPercent !== undefined) {
    values.push(patch.rolloutPercent);
    sets.push(`rollout_percent = $${values.length}`);
  }
  if (patch.rules !== undefined) {
    values.push(JSON.stringify(patch.rules));
    sets.push(`rules = $${values.length}::jsonb`);
  }
  if (sets.length === 0) {
    return getFlagById(pool, orgId, id);
  }

  const { rows } = await pool.query(
    `update feature_flags set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, org_id, key, description, enabled, rollout_percent, rules, created_at`,
    values
  );
  return rows.length ? mapFlag(rows[0]) : null;
}

export async function deleteFlag(
  pool: Pool,
  orgId: string,
  id: string
): Promise<FeatureFlag | null> {
  const { rows } = await pool.query(
    `delete from feature_flags where org_id = $1 and id = $2
     returning id, org_id, key, description, enabled, rollout_percent, rules, created_at`,
    [orgId, id]
  );
  return rows.length ? mapFlag(rows[0]) : null;
}

interface ExperimentRow {
  id: string;
  org_id: string;
  key: string;
  name: string;
  status: string;
  variants: unknown;
  created_at: Date | string;
}

function mapExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    orgId: row.org_id,
    key: row.key,
    name: row.name,
    status: row.status as ExperimentStatus,
    variants: (Array.isArray(row.variants)
      ? row.variants
      : []) as ExperimentVariant[],
    createdAt: toIso(row.created_at),
  };
}

export async function listExperiments(
  pool: Pool,
  params: { orgId: string; status?: string; limit: number; offset: number }
): Promise<{ items: Experiment[]; total: number }> {
  const values: unknown[] = [params.orgId];
  let where = "org_id = $1";
  if (params.status) {
    values.push(params.status);
    where += ` and status = $${values.length}`;
  }

  const countRes = await pool.query(
    `select count(*)::int as total from experiments where ${where}`,
    values
  );
  const total = countRes.rows[0]?.total ?? 0;

  const pageValues = [...values, params.limit, params.offset];
  const { rows } = await pool.query(
    `select id, org_id, key, name, status, variants, created_at
       from experiments
      where ${where}
      order by created_at desc
      limit $${pageValues.length - 1} offset $${pageValues.length}`,
    pageValues
  );
  return { items: rows.map(mapExperiment), total };
}

export async function getExperimentById(
  pool: Pool,
  orgId: string,
  id: string
): Promise<Experiment | null> {
  const { rows } = await pool.query(
    `select id, org_id, key, name, status, variants, created_at
       from experiments where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return rows.length ? mapExperiment(rows[0]) : null;
}

export async function createExperiment(
  pool: Pool,
  params: {
    orgId: string;
    key: string;
    name: string;
    status: ExperimentStatus;
    variants: ExperimentVariant[];
  }
): Promise<Experiment> {
  const { rows } = await pool.query(
    `insert into experiments (org_id, key, name, status, variants)
     values ($1, $2, $3, $4, $5::jsonb)
     returning id, org_id, key, name, status, variants, created_at`,
    [
      params.orgId,
      params.key,
      params.name,
      params.status,
      JSON.stringify(params.variants),
    ]
  );
  return mapExperiment(rows[0]);
}

export async function updateExperiment(
  pool: Pool,
  orgId: string,
  id: string,
  patch: {
    name?: string;
    status?: ExperimentStatus;
    variants?: ExperimentVariant[];
  }
): Promise<Experiment | null> {
  const sets: string[] = [];
  const values: unknown[] = [orgId, id];

  if (patch.name !== undefined) {
    values.push(patch.name);
    sets.push(`name = $${values.length}`);
  }
  if (patch.status !== undefined) {
    values.push(patch.status);
    sets.push(`status = $${values.length}`);
  }
  if (patch.variants !== undefined) {
    values.push(JSON.stringify(patch.variants));
    sets.push(`variants = $${values.length}::jsonb`);
  }
  if (sets.length === 0) {
    return getExperimentById(pool, orgId, id);
  }

  const { rows } = await pool.query(
    `update experiments set ${sets.join(", ")}
      where org_id = $1 and id = $2
      returning id, org_id, key, name, status, variants, created_at`,
    values
  );
  return rows.length ? mapExperiment(rows[0]) : null;
}

// Sticky assignment: return the subject's stored variant if present, otherwise
// deterministically pick one, persist it, and return it. Concurrent inserts are
// resolved by the unique index — on conflict we re-read the winning row.
export async function assignVariant(
  pool: Pool,
  params: {
    orgId: string;
    experimentId: string;
    subjectId: string;
    variant: string;
  }
): Promise<string> {
  const { rows } = await pool.query(
    `insert into experiment_assignments (org_id, experiment_id, subject_id, variant)
     values ($1, $2, $3, $4)
     on conflict (org_id, experiment_id, subject_id) do nothing
     returning variant`,
    [params.orgId, params.experimentId, params.subjectId, params.variant]
  );
  if (rows.length) return rows[0].variant;

  const existing = await pool.query(
    `select variant from experiment_assignments
      where org_id = $1 and experiment_id = $2 and subject_id = $3`,
    [params.orgId, params.experimentId, params.subjectId]
  );
  return existing.rows[0]?.variant ?? params.variant;
}

// Recent audit-log rows for a flag, org-scoped. Used by the FlagAudit panel.
export interface FlagAuditEntry {
  id: string;
  action: string;
  userId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export async function listFlagAudit(
  pool: Pool,
  orgId: string,
  flagId: string,
  limit: number
): Promise<FlagAuditEntry[]> {
  const { rows } = await pool.query(
    `select id, action, user_id, metadata, created_at
       from audit_log
      where org_id = $1 and entity_type = 'feature_flag' and entity_id = $2
      order by created_at desc
      limit $3`,
    [orgId, flagId, limit]
  );
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    userId: row.user_id,
    metadata:
      row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdAt: toIso(row.created_at),
  }));
}

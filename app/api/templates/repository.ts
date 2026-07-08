import type { Pool } from "pg";
import { z } from "zod";
import { getPool } from "@/lib/db";

// Data access + validation for reusable templates. Colocated with the template
// routes so the module owns its persistence. Every query binds org_id as a
// parameter — a tenant can never read, mutate, or delete another org's template.

// The four kinds of thing a template can describe. Kept as a bounded union so we
// never store an arbitrary kind and so filters/UX stay predictable.
export const TEMPLATE_KINDS = [
  "claim",
  "report",
  "verification",
  "document",
] as const;

export const templateKindSchema = z.enum(TEMPLATE_KINDS);
export type TemplateKind = z.infer<typeof templateKindSchema>;

// A single editable field within a template body. This is intentionally
// permissive-but-bounded: enough structure for the field editor UI to render a
// form, without over-constraining what a template can represent.
export const templateFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Field key is required.")
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, "Field key may only contain letters, numbers, and underscores."),
  label: z.string().trim().min(1, "Field label is required.").max(120),
  type: z.enum(["text", "textarea", "number", "boolean", "select"]),
  required: z.boolean().default(false),
  placeholder: z.string().trim().max(200).optional(),
  options: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
});

export type TemplateField = z.infer<typeof templateFieldSchema>;

// The template body: an ordered list of fields plus a free-form content string
// (e.g. a report skeleton or claim-intake preamble). Validated here so we never
// trust raw client JSON straight into jsonb.
export const templateBodySchema = z.object({
  fields: z.array(templateFieldSchema).max(60).default([]),
  content: z.string().max(20000).default(""),
});

export type TemplateBody = z.infer<typeof templateBodySchema>;

export const createTemplateSchema = z.object({
  kind: templateKindSchema,
  name: z.string().trim().min(1, "Template name is required.").max(120),
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().max(80).optional(),
  body: templateBodySchema.default({ fields: [], content: "" }),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

// PATCH allows partial updates; kind is immutable once created (changing a
// template's kind would silently break anything referencing it by kind).
export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1, "Template name is required.").max(120),
    description: z.string().trim().max(500).nullable(),
    category: z.string().trim().max(80).nullable(),
    body: templateBodySchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: "No fields to update.",
  });

export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export interface Template {
  id: string;
  org_id: string;
  kind: TemplateKind;
  name: string;
  description: string | null;
  category: string | null;
  body: TemplateBody;
  created_by: string | null;
  created_at: string;
  created_by_name: string | null;
  created_by_email: string | null;
}

const TEMPLATE_COLUMNS = `
  t.id, t.org_id, t.kind, t.name, t.description, t.category, t.body,
  t.created_by, t.created_at,
  u.name as created_by_name, u.email as created_by_email
`;

interface TemplateRow {
  id: string;
  org_id: string;
  kind: string;
  name: string;
  description: string | null;
  category: string | null;
  body: unknown;
  created_by: string | null;
  created_at: Date | string;
  created_by_name: string | null;
  created_by_email: string | null;
}

// Coerce a stored jsonb body/kind back through the schema so downstream code
// always sees a well-formed Template even if an older/looser row exists.
function mapRow(row: TemplateRow): Template {
  const parsedBody = templateBodySchema.safeParse(row.body);
  const body: TemplateBody = parsedBody.success
    ? parsedBody.data
    : { fields: [], content: "" };
  const parsedKind = templateKindSchema.safeParse(row.kind);
  const kind: TemplateKind = parsedKind.success ? parsedKind.data : "document";
  return {
    id: row.id,
    org_id: row.org_id,
    kind,
    name: row.name,
    description: row.description,
    category: row.category,
    body,
    created_by: row.created_by,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    created_by_name: row.created_by_name,
    created_by_email: row.created_by_email,
  };
}

export interface ListTemplatesFilters {
  kind?: TemplateKind;
  category?: string;
}

export async function listTemplates(
  orgId: string,
  limit: number,
  offset: number,
  filters: ListTemplatesFilters = {},
  pool: Pool = getPool()
): Promise<{ items: Template[]; total: number }> {
  const conditions: string[] = ["t.org_id = $1"];
  const params: unknown[] = [orgId];

  if (filters.kind) {
    params.push(filters.kind);
    conditions.push(`t.kind = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`t.category = $${params.length}`);
  }

  const where = conditions.join(" and ");

  const countResult = await pool.query<{ count: string }>(
    `select count(*)::int as count from templates t where ${where}`,
    params
  );
  const total = Number(countResult.rows[0]?.count ?? 0);

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const { rows } = await pool.query<TemplateRow>(
    `select ${TEMPLATE_COLUMNS}
       from templates t
       left join users u on u.id = t.created_by
      where ${where}
      order by t.created_at desc
      limit $${limitIdx} offset $${offsetIdx}`,
    [...params, limit, offset]
  );

  return { items: rows.map(mapRow), total };
}

// Distinct non-null categories for the org, with a count of templates in each.
// Powers the category filter and the category manager page.
export interface CategoryStat {
  category: string;
  count: number;
}

export async function listCategories(
  orgId: string,
  pool: Pool = getPool()
): Promise<CategoryStat[]> {
  const { rows } = await pool.query<{ category: string; count: string }>(
    `select t.category, count(*)::int as count
       from templates t
      where t.org_id = $1 and t.category is not null and t.category <> ''
      group by t.category
      order by t.category asc`,
    [orgId]
  );
  return rows.map((r) => ({ category: r.category, count: Number(r.count) }));
}

export async function getTemplate(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<Template | null> {
  const { rows } = await pool.query<TemplateRow>(
    `select ${TEMPLATE_COLUMNS}
       from templates t
       left join users u on u.id = t.created_by
      where t.org_id = $1 and t.id = $2`,
    [orgId, id]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

interface CreateTemplateParams extends CreateTemplateInput {
  orgId: string;
  createdBy: string | null;
}

export async function createTemplate(
  params: CreateTemplateParams,
  pool: Pool = getPool()
): Promise<Template> {
  const { orgId, createdBy, kind, name, description, category, body } = params;
  const { rows } = await pool.query<{ id: string }>(
    `insert into templates (org_id, kind, name, description, category, body, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      orgId,
      kind,
      name,
      description ?? null,
      category ?? null,
      JSON.stringify(body),
      createdBy,
    ]
  );
  const inserted = await getTemplate(orgId, rows[0].id, pool);
  if (!inserted) {
    // Unreachable: the insert just succeeded on the same pool.
    throw new Error("Template vanished immediately after creation.");
  }
  return inserted;
}

export async function updateTemplate(
  orgId: string,
  id: string,
  patch: UpdateTemplateInput,
  pool: Pool = getPool()
): Promise<Template | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, id];

  if (patch.name !== undefined) {
    params.push(patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description);
    sets.push(`description = $${params.length}`);
  }
  if (patch.category !== undefined) {
    params.push(patch.category);
    sets.push(`category = $${params.length}`);
  }
  if (patch.body !== undefined) {
    params.push(JSON.stringify(patch.body));
    sets.push(`body = $${params.length}`);
  }

  if (sets.length === 0) {
    return getTemplate(orgId, id, pool);
  }

  const result = await pool.query(
    `update templates set ${sets.join(", ")}
      where org_id = $1 and id = $2`,
    params
  );
  if ((result.rowCount ?? 0) === 0) {
    return null;
  }
  return getTemplate(orgId, id, pool);
}

export async function deleteTemplate(
  orgId: string,
  id: string,
  pool: Pool = getPool()
): Promise<boolean> {
  const result = await pool.query(
    `delete from templates where org_id = $1 and id = $2`,
    [orgId, id]
  );
  return (result.rowCount ?? 0) > 0;
}

// Duplicate an existing template into a new row (same org). Returns null if the
// source template doesn't exist / isn't visible to this org.
export async function duplicateTemplate(
  orgId: string,
  id: string,
  createdBy: string | null,
  pool: Pool = getPool()
): Promise<Template | null> {
  const source = await getTemplate(orgId, id, pool);
  if (!source) {
    return null;
  }
  const copyName = `${source.name} (copy)`.slice(0, 120);
  return createTemplate(
    {
      orgId,
      createdBy,
      kind: source.kind,
      name: copyName,
      description: source.description ?? undefined,
      category: source.category ?? undefined,
      body: source.body,
    },
    pool
  );
}

import { z } from "zod";

// Domain types and validation schemas for the Reporting engine. Every request
// body is validated at the API boundary with zod before use — raw JSON is never
// trusted directly.

// The kind of report a definition produces. Bounded to an allow-list so callers
// cannot invent arbitrary types; each type maps to a composer branch that only
// reads org-scoped tables.
export type ReportType = "summary" | "claims" | "reviews" | "documents";

export const REPORT_TYPES: readonly ReportType[] = [
  "summary",
  "claims",
  "reviews",
  "documents",
];

export type ReportFormat = "json" | "csv" | "html";

export const REPORT_FORMATS: readonly ReportFormat[] = ["json", "csv", "html"];

export type RunStatus = "pending" | "running" | "complete" | "failed";

// A single section of a report layout. `kind` selects a widget the PreviewPanel
// knows how to render; `field` is an optional data key it binds to.
export interface LayoutSection {
  id: string;
  title: string;
  kind: "metric" | "table" | "breakdown" | "text";
  field?: string;
}

export interface ReportLayout {
  sections: LayoutSection[];
}

// A single filter clause applied when composing a run. Field/operator/value are
// module-defined free text but bounded so a malformed payload can't be stored.
export interface ReportFilter {
  field: string;
  operator: string;
  value: string;
}

export interface ReportFilters {
  filters: ReportFilter[];
  since?: string;
}

export interface ReportDefinition {
  id: string;
  orgId: string;
  name: string;
  type: ReportType;
  layout: ReportLayout;
  filters: ReportFilters;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

// One composed data row rendered by the PreviewPanel / RunDetail. Kept generic
// so composer branches can emit metrics and breakdowns uniformly.
export interface ReportMetric {
  label: string;
  value: number;
}

export interface ReportBreakdownRow {
  label: string;
  count: number;
}

export interface ReportResult {
  generatedAt: string;
  type: ReportType;
  metrics: ReportMetric[];
  breakdown: ReportBreakdownRow[];
  notes: string[];
}

export interface ReportRun {
  id: string;
  orgId: string;
  definitionId: string;
  definitionName: string | null;
  status: RunStatus;
  result: ReportResult | null;
  format: ReportFormat;
  createdBy: string | null;
  error: string | null;
  createdAt: string;
}

export interface ScheduledReport {
  id: string;
  orgId: string;
  definitionId: string;
  definitionName: string | null;
  cron: string;
  recipients: string[];
  enabled: boolean;
  createdBy: string | null;
  createdAt: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidField = z.string().regex(UUID_RE, "A valid id is required.");

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

const nameField = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(120, "Name is too long.");

const typeField = z.enum(["summary", "claims", "reviews", "documents"]);

const layoutSectionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1, "Section title is required.").max(120),
  kind: z.enum(["metric", "table", "breakdown", "text"]),
  field: z.string().trim().max(80).optional(),
});

export const layoutSchema = z.object({
  sections: z.array(layoutSectionSchema).max(25).default([]),
});

const filterSchema = z.object({
  field: z.string().trim().min(1, "Filter field is required.").max(80),
  operator: z.string().trim().min(1, "Filter operator is required.").max(32),
  value: z.string().max(500),
});

export const filtersSchema = z.object({
  filters: z.array(filterSchema).max(25).default([]),
  since: z.string().trim().max(40).optional(),
});

export const createDefinitionSchema = z.object({
  name: nameField,
  type: typeField,
  layout: layoutSchema.default({ sections: [] }),
  filters: filtersSchema.default({ filters: [] }),
});

// PATCH: all fields optional, but at least one must be present.
export const updateDefinitionSchema = z
  .object({
    name: nameField.optional(),
    type: typeField.optional(),
    layout: layoutSchema.optional(),
    filters: filtersSchema.optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.type !== undefined ||
      v.layout !== undefined ||
      v.filters !== undefined,
    { message: "No fields to update." }
  );

export const runDefinitionSchema = z.object({
  format: z.enum(["json", "csv", "html"]).default("json"),
});

const recipientsField = z
  .array(z.string().trim().email("Each recipient must be a valid email.").max(200))
  .max(50, "Too many recipients.");

// A permissive cron guard: 5 or 6 whitespace-separated fields. Full cron parsing
// is left to the scheduler; this only rejects obviously malformed input.
const cronField = z
  .string()
  .trim()
  .min(1, "A cron expression is required.")
  .max(120)
  .refine((v) => {
    const parts = v.split(/\s+/);
    return parts.length === 5 || parts.length === 6;
  }, "Cron must have 5 or 6 fields.");

export const createScheduleSchema = z.object({
  definitionId: uuidField,
  cron: cronField,
  recipients: recipientsField.default([]),
  enabled: z.boolean().optional(),
});

export const updateScheduleSchema = z
  .object({
    cron: cronField.optional(),
    recipients: recipientsField.optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.cron !== undefined ||
      v.recipients !== undefined ||
      v.enabled !== undefined,
    { message: "No fields to update." }
  );

export function isReportType(value: string | null): value is ReportType {
  return value !== null && (REPORT_TYPES as readonly string[]).includes(value);
}

export type CreateDefinitionInput = z.infer<typeof createDefinitionSchema>;
export type UpdateDefinitionInput = z.infer<typeof updateDefinitionSchema>;
export type RunDefinitionInput = z.infer<typeof runDefinitionSchema>;
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

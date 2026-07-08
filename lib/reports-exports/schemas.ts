import { z } from "zod";

// Zod schemas for the reporting & exports module. All external input (request
// bodies, query params) is validated against these before it reaches the SQL or
// document-generation layers — never trust raw JSON from a client.

// The data domains a report or export can target. Kept in sync with the CHECK
// constraints in db/migrations/0008_reports-exports.sql.
export const REPORT_TYPES = ["verifications", "claims", "evidence"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const reportTypeSchema = z.enum(REPORT_TYPES);

// Output formats an export can produce.
export const EXPORT_FORMATS = ["csv", "markdown"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const exportFormatSchema = z.enum(EXPORT_FORMATS);

// Terminal + transient states an export job can be in.
export const EXPORT_STATUSES = [
  "pending",
  "processing",
  "complete",
  "failed",
] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

// Optional config persisted with a saved report. Mirrors the filters an export
// accepts so a report can be re-run into an export later. Kept permissive.
export const reportConfigSchema = z.object({
  project_id: z.string().uuid().nullable().optional(),
  format: exportFormatSchema.optional(),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;

// Body for POST /api/reports.
export const createReportSchema = z.object({
  name: z.string().trim().min(1, "Report name is required.").max(200),
  type: reportTypeSchema,
  project_id: z.string().uuid().nullable().optional(),
  config: reportConfigSchema.optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

// Body for POST /api/exports. project_id narrows the exported rows to one project.
export const createExportSchema = z.object({
  type: reportTypeSchema,
  format: exportFormatSchema,
  project_id: z.string().uuid().nullable().optional(),
});
export type CreateExportInput = z.infer<typeof createExportSchema>;

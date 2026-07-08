import { z } from "zod";

// Zod schemas for the data export center. All external input (request bodies,
// query params) is validated against these before it reaches SQL or the document
// builder — never trust raw JSON from a client.

// The data domains an export can target. Kept in sync with the CHECK constraint
// in db/migrations/0042_data-export.sql.
export const EXPORT_SCOPES = [
  "claims",
  "verifications",
  "evidence",
  "documents",
  "references",
] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];
export const exportScopeSchema = z.enum(EXPORT_SCOPES);

// Output formats an export can produce.
export const EXPORT_FORMATS = ["csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const exportFormatSchema = z.enum(EXPORT_FORMATS);

// Terminal + transient states an export can be in.
export const EXPORT_STATUSES = [
  "pending",
  "processing",
  "complete",
  "failed",
] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

// Body for POST /api/data-exports. project_id narrows the exported rows to one
// project; omitted means the whole org for that scope.
export const createExportSchema = z.object({
  scope: exportScopeSchema,
  format: exportFormatSchema,
  project_id: z.string().uuid().nullable().optional(),
});
export type CreateExportInput = z.infer<typeof createExportSchema>;

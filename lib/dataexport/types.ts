import type {
  ExportFormat,
  ExportScope,
  ExportStatus,
} from "@/lib/dataexport/schemas";

// Row shapes returned by the data export repository / APIs. Shared by the server
// (repository, routes) and the client console pages so both agree on the
// envelope contents.

export interface ExportParams {
  project_id?: string | null;
  // Cached at build time so history / detail views don't recompute.
  filename?: string;
}

export interface DataExport {
  id: string;
  org_id: string;
  scope: ExportScope;
  format: ExportFormat;
  status: ExportStatus;
  row_count: number;
  params: ExportParams;
  created_by: string | null;
  created_at: string;
  // Denormalized author name/email for display (nullable — user may be gone).
  created_by_name: string | null;
  created_by_email: string | null;
}

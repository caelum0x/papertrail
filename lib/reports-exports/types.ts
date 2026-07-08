import type { ExportStatus, ReportConfig, ReportType } from "@/lib/reports-exports/schemas";

// Row shapes returned by the reports & exports repository / APIs. Shared by the
// server (repository, routes) and the client console pages so both agree on the
// envelope contents.

export interface Report {
  id: string;
  org_id: string;
  project_id: string | null;
  name: string;
  type: ReportType;
  config: ReportConfig;
  created_by: string | null;
  created_at: string;
  // Denormalized author name/email for display (nullable — user may be gone).
  created_by_name: string | null;
  created_by_email: string | null;
}

export interface ExportJob {
  id: string;
  org_id: string;
  type: ReportType;
  status: ExportStatus;
  result_url: string | null;
  params: {
    format?: string;
    project_id?: string | null;
    row_count?: number;
    filename?: string;
  };
  created_by: string | null;
  created_at: string;
}

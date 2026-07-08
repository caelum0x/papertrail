// Shared types for the document library module. These describe rows as returned
// to API clients (org_id is intentionally omitted from client-facing shapes;
// scoping is enforced server-side).

export type DocumentStatus = "pending" | "processing" | "extracted" | "failed";

export interface DocumentSummary {
  id: string;
  project_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentDetail extends DocumentSummary {
  storage_key: string | null;
  extracted_text: string | null;
  page_count: number;
}

export interface DocumentPage {
  page_number: number;
  text: string | null;
}

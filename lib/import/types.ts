import { z } from "zod";

// Domain types and zod schemas for the bulk import/export center. Every request
// body is validated at the API boundary before touching the database. No LLM
// involvement here — parsing is deterministic.

// Where imported rows ultimately land. Each target has a fixed set of insertable
// fields the mapping can address (see TARGET_FIELDS below).
export const IMPORT_TARGETS = ["claims", "evidence", "references"] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export const IMPORT_FORMATS = ["csv", "bibtex", "ris"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const IMPORT_BATCH_STATUSES = [
  "pending",
  "committing",
  "committed",
  "failed",
] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_ROW_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

// A single field the mapping can populate for a given target. `required` fields
// must be mapped (and non-empty per row) or the row is rejected at commit.
export interface TargetField {
  key: string;
  label: string;
  required: boolean;
}

// The insertable field set per target. The MappingStep in the wizard renders one
// selector per field; the commit step reads mapped columns off each parsed row.
export const TARGET_FIELDS: Record<ImportTarget, readonly TargetField[]> = {
  claims: [
    { key: "text", label: "Claim text", required: true },
    { key: "cited_source_url", label: "Cited source URL", required: false },
    { key: "status", label: "Status", required: false },
  ],
  evidence: [
    { key: "title", label: "Title", required: true },
    { key: "source_type", label: "Source type", required: false },
    { key: "external_id", label: "External ID", required: false },
    { key: "url", label: "URL", required: false },
    { key: "notes", label: "Notes", required: false },
  ],
  references: [
    { key: "title", label: "Title", required: true },
    { key: "type", label: "Type", required: false },
    { key: "authors", label: "Authors (semicolon-separated)", required: false },
    { key: "year", label: "Year", required: false },
    { key: "journal", label: "Journal", required: false },
    { key: "doi", label: "DOI", required: false },
    { key: "pmid", label: "PMID", required: false },
    { key: "nct_id", label: "NCT ID", required: false },
    { key: "url", label: "URL", required: false },
  ],
};

// A batch as returned to the client (camelCase, ISO timestamps).
export interface ImportBatch {
  id: string;
  orgId: string;
  target: ImportTarget;
  format: ImportFormat;
  status: ImportBatchStatus;
  total: number;
  succeeded: number;
  failed: number;
  mapping: Record<string, string>;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
}

// One staged source record within a batch.
export interface ImportRow {
  id: string;
  orgId: string;
  batchId: string;
  rowIndex: number;
  data: Record<string, string>;
  status: ImportRowStatus;
  error: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

// The mapping maps a TARGET field key -> a source column name (CSV header or a
// canonical parsed key like "title"/"authors" for BibTeX/RIS). Empty string means
// "not mapped".
const mappingSchema = z.record(z.string(), z.string());

// POST /api/imports — create a batch from pasted text. `libraryId` is required
// only when target === 'references' (rows need an owning library).
export const createImportSchema = z
  .object({
    target: z.enum(IMPORT_TARGETS),
    format: z.enum(IMPORT_FORMATS),
    text: z.string().min(1, "Provide the file contents to import.").max(2_000_000),
    mapping: mappingSchema.default({}),
    libraryId: z.string().uuid().optional(),
  })
  .strict();

export type CreateImportInput = z.infer<typeof createImportSchema>;

// POST /api/imports/[id]/commit — optionally (re)confirm the mapping and library
// at commit time. All fields optional; the stored batch values are used as the
// fallback.
export const commitImportSchema = z
  .object({
    mapping: mappingSchema.optional(),
    libraryId: z.string().uuid().optional(),
  })
  .strict();

export type CommitImportInput = z.infer<typeof commitImportSchema>;

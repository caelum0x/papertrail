import { z } from "zod";

// Domain types and validation schemas for the Saved views module. Every request
// body is validated at the API boundary with zod before use.

// Resource types a saved view can target. Kept as a text column in the DB but
// validated to this allow-list at the API boundary so callers cannot invent
// arbitrary targets. These map to the console list pages that embed SavedViewBar.
export type ViewResource =
  | "claims"
  | "references"
  | "documents"
  | "projects"
  | "reviews"
  | "reports"
  | "sources";

export const VIEW_RESOURCES: readonly ViewResource[] = [
  "claims",
  "references",
  "documents",
  "projects",
  "reviews",
  "reports",
  "sources",
];

export type SortDirection = "asc" | "desc";

export interface ViewFilter {
  field: string;
  operator: string;
  value: string;
}

export interface ViewSort {
  field: string;
  direction: SortDirection;
}

// The opaque-but-validated query payload persisted in saved_views.query jsonb.
export interface ViewQuery {
  search?: string;
  filters: ViewFilter[];
  sort: ViewSort[];
}

export interface SavedView {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  resource: ViewResource;
  query: ViewQuery;
  shared: boolean;
  isOwner: boolean;
  ownerName: string | null;
  createdAt: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidField = z.string().regex(UUID_RE, "A valid id is required.");

const nameField = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(120, "Name is too long.");

const resourceField = z.enum([
  "claims",
  "references",
  "documents",
  "projects",
  "reviews",
  "reports",
  "sources",
]);

// A single filter clause. Field/operator/value are free text (module-defined)
// but bounded so a malformed or oversized payload can't be persisted.
const filterSchema = z.object({
  field: z.string().trim().min(1, "Filter field is required.").max(80),
  operator: z.string().trim().min(1, "Filter operator is required.").max(32),
  value: z.string().max(500),
});

const sortSchema = z.object({
  field: z.string().trim().min(1, "Sort field is required.").max(80),
  direction: z.enum(["asc", "desc"]),
});

// The query payload. Defaults keep filters/sort as arrays so downstream code
// never has to null-check. Capped to keep the jsonb small and predictable.
export const viewQuerySchema = z.object({
  search: z.string().trim().max(500).optional(),
  filters: z.array(filterSchema).max(25).default([]),
  sort: z.array(sortSchema).max(10).default([]),
});

export const createViewSchema = z.object({
  name: nameField,
  resource: resourceField,
  query: viewQuerySchema,
  shared: z.boolean().optional(),
});

// PATCH: all fields optional, but at least one must be present.
export const updateViewSchema = z
  .object({
    name: nameField.optional(),
    query: viewQuerySchema.optional(),
    shared: z.boolean().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.query !== undefined || v.shared !== undefined,
    { message: "No fields to update." }
  );

export function isViewResource(value: string | null): value is ViewResource {
  return value !== null && (VIEW_RESOURCES as readonly string[]).includes(value);
}

export type CreateViewInput = z.infer<typeof createViewSchema>;
export type UpdateViewInput = z.infer<typeof updateViewSchema>;
export type ViewQueryInput = z.infer<typeof viewQuerySchema>;

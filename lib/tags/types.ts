import { z } from "zod";

// Domain types and validation schemas for the Tags & taxonomy module. Every
// request body is validated at the API boundary with zod before use.

// Canonical set of entity types a tag may be attached to. Kept permissive at the
// DB level (text column) but validated to this allow-list at the API boundary so
// callers cannot invent arbitrary polymorphic targets.
export type TaggableEntityType =
  | "claim"
  | "reference"
  | "document"
  | "project"
  | "review"
  | "report";

export const TAGGABLE_ENTITY_TYPES: readonly TaggableEntityType[] = [
  "claim",
  "reference",
  "document",
  "project",
  "review",
  "report",
];

export interface Tag {
  id: string;
  orgId: string;
  name: string;
  color: string;
  parentId: string | null;
  usageCount?: number;
  createdAt: string;
}

// A tag node in the taxonomy tree: the tag plus its nested children.
export interface TagTreeNode extends Tag {
  children: TagTreeNode[];
}

export interface Tagging {
  id: string;
  orgId: string;
  tagId: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

// Where a tag is used, grouped so the detail page can show a breakdown.
export interface TagUsageGroup {
  entityType: string;
  count: number;
}

export interface TagUsage {
  total: number;
  groups: TagUsageGroup[];
  taggings: Tagging[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// #rgb or #rrggbb hex colors only.
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const colorField = z
  .string()
  .trim()
  .regex(HEX_COLOR_RE, "Color must be a hex value like #64748b.");

const nameField = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(120, "Name is too long.");

const parentField = z
  .string()
  .regex(UUID_RE, "A valid parent tag id is required.")
  .nullable()
  .optional();

export const createTagSchema = z.object({
  name: nameField,
  color: colorField.optional(),
  parentId: parentField,
});

// PATCH: all fields optional, but at least one must be present.
export const updateTagSchema = z
  .object({
    name: nameField.optional(),
    color: colorField.optional(),
    parentId: parentField,
  })
  .refine(
    (v) =>
      v.name !== undefined || v.color !== undefined || v.parentId !== undefined,
    { message: "No fields to update." }
  );

export const entityTypeSchema = z.enum([
  "claim",
  "reference",
  "document",
  "project",
  "review",
  "report",
]);

export const createTaggingSchema = z.object({
  tagId: z.string().regex(UUID_RE, "A valid tag id is required."),
  entityType: entityTypeSchema,
  entityId: z.string().regex(UUID_RE, "A valid entity id is required."),
});

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type CreateTaggingInput = z.infer<typeof createTaggingSchema>;

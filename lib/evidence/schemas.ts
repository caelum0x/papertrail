import { z } from "zod";
import { EVIDENCE_SOURCE_TYPES } from "@/lib/evidence/types";

// Zod schemas validate all input at the API boundary. Never trust the raw
// request body — parse it through these before touching the database.

const tagSchema = z
  .string()
  .trim()
  .min(1, "Tags cannot be empty.")
  .max(64, "Tags must be 64 characters or fewer.");

const uuidSchema = z.string().uuid();

export const createEvidenceSchema = z.object({
  project_id: uuidSchema.nullish(),
  source_type: z.enum(EVIDENCE_SOURCE_TYPES),
  external_id: z.string().trim().max(256).nullish(),
  title: z.string().trim().min(1, "Title is required.").max(512),
  url: z.string().trim().url("Must be a valid URL.").max(2048).nullish(),
  notes: z.string().trim().max(10000).nullish(),
  tags: z.array(tagSchema).max(50).optional(),
});

export type CreateEvidenceInput = z.infer<typeof createEvidenceSchema>;

export const updateEvidenceSchema = z
  .object({
    project_id: uuidSchema.nullish(),
    source_type: z.enum(EVIDENCE_SOURCE_TYPES).optional(),
    external_id: z.string().trim().max(256).nullish(),
    title: z.string().trim().min(1, "Title is required.").max(512).optional(),
    url: z.string().trim().url("Must be a valid URL.").max(2048).nullish(),
    notes: z.string().trim().max(10000).nullish(),
    tags: z.array(tagSchema).max(50).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update.",
  });

export type UpdateEvidenceInput = z.infer<typeof updateEvidenceSchema>;

export const tagsSchema = z.object({
  tags: z.array(tagSchema).min(1, "Provide at least one tag.").max(50),
});

export type TagsInput = z.infer<typeof tagsSchema>;

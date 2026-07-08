import { z } from "zod";

// Validation schemas for document API request bodies. All LLM/user-supplied
// input is validated at the boundary before it touches the database.

const uuid = z.string().uuid();

// POST /api/documents — create metadata for a document without content yet.
export const createDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(500),
  mime_type: z.string().trim().min(1).max(200).optional(),
  size_bytes: z.number().int().min(0).max(2_000_000_000).optional(),
  project_id: uuid.nullable().optional(),
  storage_key: z.string().trim().max(1000).nullable().optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

// POST /api/documents/upload — accept text directly or base64-encoded text.
export const uploadDocumentSchema = z
  .object({
    filename: z.string().trim().min(1).max(500),
    mime_type: z.string().trim().min(1).max(200).optional(),
    project_id: uuid.nullable().optional(),
    // Exactly one of `text` or `content_base64` must be provided.
    text: z.string().optional(),
    content_base64: z.string().optional(),
  })
  .refine(
    (v) => typeof v.text === "string" || typeof v.content_base64 === "string",
    { message: "Provide either `text` or `content_base64`." }
  );

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;

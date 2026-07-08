import { z } from "zod";

// Domain types and validation schemas for the Reference manager module. No LLM
// involvement, but every request body is validated at the API boundary with zod.

// Common reference types across BibTeX/RIS. Kept as a permissive string with a
// small canonical set for the UI; import may carry any type from the source file.
export type ReferenceType =
  | "article"
  | "book"
  | "inproceedings"
  | "techreport"
  | "misc"
  | "thesis"
  | "dataset"
  | "webpage";

export const REFERENCE_TYPES: readonly ReferenceType[] = [
  "article",
  "book",
  "inproceedings",
  "techreport",
  "misc",
  "thesis",
  "dataset",
  "webpage",
];

export interface ReferenceLibrary {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  referenceCount?: number;
  createdAt: string;
}

export interface Reference {
  id: string;
  orgId: string;
  libraryId: string;
  type: string;
  title: string | null;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  pmid: string | null;
  nctId: string | null;
  url: string | null;
  raw: Record<string, unknown>;
  createdAt: string;
}

// Shape produced by the BibTeX/RIS parsers and accepted by createReference.
export interface ParsedReference {
  type: string;
  title: string | null;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  pmid: string | null;
  nctId: string | null;
  url: string | null;
  raw: Record<string, unknown>;
}

const CURRENT_YEAR = new Date().getUTCFullYear();

export const createLibrarySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  projectId: z.string().uuid("A valid project id is required.").optional().nullable(),
});

const yearField = z
  .number()
  .int()
  .min(1400, "Year is out of range.")
  .max(CURRENT_YEAR + 1, "Year is out of range.")
  .nullable()
  .optional();

export const referenceFieldsSchema = z.object({
  type: z.string().trim().min(1).max(50).default("article"),
  title: z.string().trim().max(1000).nullable().optional(),
  authors: z.array(z.string().trim().min(1).max(300)).max(500).default([]),
  year: yearField,
  journal: z.string().trim().max(500).nullable().optional(),
  doi: z.string().trim().max(200).nullable().optional(),
  pmid: z.string().trim().max(50).nullable().optional(),
  nctId: z.string().trim().max(50).nullable().optional(),
  url: z.string().trim().max(2000).nullable().optional(),
  raw: z.record(z.unknown()).optional(),
});

export const createReferenceSchema = referenceFieldsSchema.extend({
  libraryId: z.string().uuid("A valid library id is required."),
});

export const updateReferenceSchema = z
  .object({
    type: z.string().trim().min(1).max(50).optional(),
    title: z.string().trim().max(1000).nullable().optional(),
    authors: z.array(z.string().trim().min(1).max(300)).max(500).optional(),
    year: z
      .number()
      .int()
      .min(1400, "Year is out of range.")
      .max(CURRENT_YEAR + 1, "Year is out of range.")
      .nullable()
      .optional(),
    journal: z.string().trim().max(500).nullable().optional(),
    doi: z.string().trim().max(200).nullable().optional(),
    pmid: z.string().trim().max(50).nullable().optional(),
    nctId: z.string().trim().max(50).nullable().optional(),
    url: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No fields to update.",
  });

export const importSchema = z.object({
  libraryId: z.string().uuid("A valid library id is required."),
  format: z.enum(["bibtex", "ris"]),
  text: z.string().min(1, "Import text is required.").max(2_000_000),
});

export const EXPORT_FORMATS = ["bibtex", "ris", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type CreateLibraryInput = z.infer<typeof createLibrarySchema>;
export type CreateReferenceInput = z.infer<typeof createReferenceSchema>;
export type UpdateReferenceInput = z.infer<typeof updateReferenceSchema>;
export type ImportInput = z.infer<typeof importSchema>;

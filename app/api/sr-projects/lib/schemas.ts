import { z } from "zod";

// Boundary validation for the systematic-review APIs. Never trust request
// bodies or query strings — parse them through these schemas before use.

export const SR_PROJECT_STATUSES = ["active", "completed", "archived"] as const;

export const SR_SOURCE_TYPES = [
  "pubmed",
  "clinicaltrials",
  "manual",
  "other",
] as const;

export const SCREENING_STAGES = ["title_abstract", "full_text"] as const;

export const SCREENING_DECISIONS = ["include", "exclude"] as const;

// Body for POST /api/sr-projects — start a new systematic review.
export const createSrProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  question: z.string().trim().min(1, "A research question is required.").max(5000),
  inclusionCriteria: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  projectId: z.string().uuid().nullish(),
});

export type CreateSrProjectInput = z.infer<typeof createSrProjectSchema>;

// Body for PATCH /api/sr-projects/[id] — edit metadata / advance status.
export const updateSrProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    question: z.string().trim().min(1).max(5000).optional(),
    inclusionCriteria: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    status: z.enum(SR_PROJECT_STATUSES).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "No fields to update.",
  });

export type UpdateSrProjectInput = z.infer<typeof updateSrProjectSchema>;

// One imported candidate record.
export const srRecordInputSchema = z.object({
  sourceType: z.enum(SR_SOURCE_TYPES).default("manual"),
  externalId: z.string().trim().min(1).max(200).nullish(),
  title: z.string().trim().min(1, "Title is required.").max(2000),
  abstract: z.string().trim().max(20000).nullish(),
});

// Body for POST /api/sr-projects/[id]/records — import one or many candidates.
export const importRecordsSchema = z.object({
  records: z
    .array(srRecordInputSchema)
    .min(1, "Provide at least one record.")
    .max(500, "Import at most 500 records at a time."),
});

export type ImportRecordsInput = z.infer<typeof importRecordsSchema>;

// Body for POST /api/sr-records/[id]/screen — record an include/exclude decision.
export const screenRecordSchema = z
  .object({
    stage: z.enum(SCREENING_STAGES),
    decision: z.enum(SCREENING_DECISIONS),
    reason: z.string().trim().max(2000).nullish(),
  })
  .refine((v) => v.decision === "include" || Boolean(v.reason), {
    message: "A reason is required when excluding a record.",
  });

export type ScreenRecordInput = z.infer<typeof screenRecordSchema>;

// Query filter for GET /api/sr-projects/[id]/records.
export const recordsQuerySchema = z.object({
  status: z
    .enum([
      "pending",
      "title_included",
      "title_excluded",
      "fulltext_included",
      "fulltext_excluded",
    ])
    .optional(),
});

export type RecordsQueryInput = z.infer<typeof recordsQuerySchema>;

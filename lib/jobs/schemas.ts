import { z } from "zod";
import { JOB_STATUSES } from "@/lib/jobs/types";
import { isValidCron } from "@/lib/jobs/scheduler";

// Boundary validation for the jobs & schedules APIs. Never trust request bodies
// or query strings — parse them through these schemas before use.

// A job type is a short slug identifying which registered handler runs. Kept
// permissive (the registry rejects unknown types at enqueue time) but bounded.
const jobType = z
  .string()
  .trim()
  .min(1, "type is required.")
  .max(120, "type is too long.");

// Body for POST /api/jobs — enqueue a job.
export const enqueueJobSchema = z.object({
  type: jobType,
  payload: z.record(z.unknown()).optional(),
  runAfter: z.string().datetime().optional(),
});

export type EnqueueJobInput = z.infer<typeof enqueueJobSchema>;

// Query filters for GET /api/jobs.
export const jobsQuerySchema = z.object({
  status: z.enum(JOB_STATUSES).optional(),
  type: jobType.optional(),
});

export type JobsQueryInput = z.infer<typeof jobsQuerySchema>;

// Body for POST /api/schedules — create a cron-like schedule.
export const createScheduleSchema = z.object({
  name: z.string().trim().min(1, "name is required.").max(200),
  type: jobType,
  cron: z
    .string()
    .trim()
    .refine((v) => isValidCron(v), "Invalid cron expression (expected 5 fields)."),
  payload: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

// Body for PATCH /api/schedules/[id] — edit an existing schedule.
export const updateScheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    cron: z
      .string()
      .trim()
      .refine((v) => isValidCron(v), "Invalid cron expression (expected 5 fields).")
      .optional(),
    payload: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "No fields to update.",
  });

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

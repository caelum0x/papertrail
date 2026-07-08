import { z } from "zod";
import {
  MONITOR_SOURCE_TYPES,
  MONITOR_FREQUENCIES,
  MONITOR_HIT_STATUSES,
  AE_SEVERITIES,
  AE_STATUSES,
} from "@/lib/monitoring/types";

// Zod schemas validate every request body at the API boundary. Never trust the
// raw body — parse it through these before touching the database.

const uuidSchema = z.string().uuid();

export const createMonitorSchema = z.object({
  project_id: uuidSchema.nullish(),
  name: z.string().trim().min(1, "Name is required.").max(200),
  query: z.string().trim().min(1, "Query is required.").max(1000),
  sources: z
    .array(z.enum(MONITOR_SOURCE_TYPES))
    .min(1, "Select at least one source.")
    .max(MONITOR_SOURCE_TYPES.length)
    .optional(),
  frequency: z.enum(MONITOR_FREQUENCIES).optional(),
  enabled: z.boolean().optional(),
});

export type CreateMonitorInput = z.infer<typeof createMonitorSchema>;

export const updateMonitorSchema = z
  .object({
    project_id: uuidSchema.nullish(),
    name: z.string().trim().min(1, "Name is required.").max(200).optional(),
    query: z.string().trim().min(1, "Query is required.").max(1000).optional(),
    sources: z
      .array(z.enum(MONITOR_SOURCE_TYPES))
      .min(1, "Select at least one source.")
      .max(MONITOR_SOURCE_TYPES.length)
      .optional(),
    frequency: z.enum(MONITOR_FREQUENCIES).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update.",
  });

export type UpdateMonitorInput = z.infer<typeof updateMonitorSchema>;

export const triageHitSchema = z.object({
  status: z.enum(MONITOR_HIT_STATUSES),
});

export type TriageHitInput = z.infer<typeof triageHitSchema>;

export const createAeSignalSchema = z.object({
  drug: z.string().trim().min(1, "Drug is required.").max(200),
  event: z.string().trim().min(1, "Event is required.").max(300),
  severity: z.enum(AE_SEVERITIES).optional(),
  status: z.enum(AE_STATUSES).optional(),
  notes: z.string().trim().max(10000).nullish(),
});

export type CreateAeSignalInput = z.infer<typeof createAeSignalSchema>;

export const updateAeSignalSchema = z
  .object({
    drug: z.string().trim().min(1, "Drug is required.").max(200).optional(),
    event: z.string().trim().min(1, "Event is required.").max(300).optional(),
    severity: z.enum(AE_SEVERITIES).optional(),
    status: z.enum(AE_STATUSES).optional(),
    notes: z.string().trim().max(10000).nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No fields to update.",
  });

export type UpdateAeSignalInput = z.infer<typeof updateAeSignalSchema>;

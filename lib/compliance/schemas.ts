import { z } from "zod";
import { SIGNATURE_MEANINGS } from "@/lib/compliance/types";

// Zod schemas validating all request bodies at the Compliance API boundary.
// Never trust raw JSON — every mutation parses through one of these first.

export const createSignatureSchema = z.object({
  entityType: z
    .string()
    .trim()
    .min(1, "entityType is required.")
    .max(64, "entityType is too long."),
  entityId: z.string().uuid("entityId must be a valid uuid."),
  meaning: z.enum(SIGNATURE_MEANINGS, {
    errorMap: () => ({ message: "Invalid signature meaning." }),
  }),
});

export type CreateSignatureInput = z.infer<typeof createSignatureSchema>;

export const upsertRetentionPolicySchema = z.object({
  entityType: z
    .string()
    .trim()
    .min(1, "entityType is required.")
    .max(64, "entityType is too long."),
  retainDays: z
    .number()
    .int("retainDays must be an integer.")
    .min(0, "retainDays cannot be negative.")
    .max(36500, "retainDays cannot exceed 100 years."),
});

export type UpsertRetentionPolicyInput = z.infer<
  typeof upsertRetentionPolicySchema
>;

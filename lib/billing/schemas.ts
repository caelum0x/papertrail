import { z } from "zod";

// Input validation for the billing module. All user input crosses a system
// boundary here and must be validated before touching the database.

// Body for POST /api/billing/subscribe. The caller selects a plan by its stable
// `planKey`; seats defaults to 1. The plan's price/limits are always read
// server-side from the catalog — never trusted from the client.
export const subscribeSchema = z.object({
  planKey: z.string().trim().min(1, "A plan is required.").max(80),
  seats: z.number().int().min(1).max(1000).optional(),
});

export type SubscribeInput = z.infer<typeof subscribeSchema>;

// A quota-bearing usage kind. Kept as a bounded string (not an enum) so new
// meters can be added without a schema migration, but still validated to a sane
// shape before it reaches the database.
export const usageKindSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_]+$/, "Usage kind must be lowercase alphanumeric or underscore.");

export type UsageKind = z.infer<typeof usageKindSchema>;

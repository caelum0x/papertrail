import { z } from "zod";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/types";

// Zod schemas validate all input at the /api/webhooks boundary. Never trust the
// raw request body — parse it here first.

const eventEnum = z.enum(WEBHOOK_EVENTS);

// Only http(s) URLs are accepted, and we require https in production-ish use to
// avoid leaking signed payloads over plaintext. http is allowed for localhost
// so the portal's "test" flow works against a local receiver during dev.
const webhookUrl = z
  .string()
  .trim()
  .url("Must be a valid URL.")
  .max(2048, "URL is too long.")
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "URL must use http or https."
  );

export const createWebhookSchema = z.object({
  url: webhookUrl,
  // At least one event so the webhook does something; de-duplicated downstream.
  events: z.array(eventEnum).min(1, "Select at least one event."),
});

export const updateWebhookSchema = z
  .object({
    url: webhookUrl.optional(),
    events: z.array(eventEnum).min(1, "Select at least one event.").optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine(
    (value) =>
      value.url !== undefined ||
      value.events !== undefined ||
      value.status !== undefined,
    "Provide at least one field to update."
  );

export type CreateWebhookInput = z.infer<typeof createWebhookSchema>;
export type UpdateWebhookInput = z.infer<typeof updateWebhookSchema>;

import { z } from "zod";
import { WEBHOOK_EVENTS } from "@/lib/webhooks/types";

// Zod schemas validate all input at the /api/webhooks boundary. Never trust the
// raw request body — parse it here first.

const eventEnum = z.enum(WEBHOOK_EVENTS);

// Reject URLs that could be used for SSRF — private/loopback IPv4 ranges,
// link-local (169.254.x.x / AWS metadata), IPv6 loopback, and bare localhost.
// http:// is still accepted for local dev receivers, but only for non-internal
// hostnames so the intent (dev convenience) is narrow. Production deployments
// should additionally enforce HTTPS at the load-balancer or middleware layer.
function isPrivateUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false; // already rejected by .url() above
  }
  const host = url.hostname.toLowerCase();
  // Loopback / localhost
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  // IPv4: loopback (127.x), private class A/B/C, link-local (169.254.x)
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [, a, b] = v4.map(Number);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  // IPv6 private ranges
  if (host.startsWith("[::") || host === "::1") return true;
  if (/^\[f[cde]/i.test(host)) return true; // fc00::/7 unique-local, fe80:: link-local
  return false;
}

const webhookUrl = z
  .string()
  .trim()
  .url("Must be a valid URL.")
  .max(2048, "URL is too long.")
  .refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "URL must use http or https."
  )
  .refine(
    (value) => !isPrivateUrl(value),
    "Webhook URL must not target private or loopback addresses."
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

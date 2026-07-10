import { z } from "zod";
import { SECURITY_POLICY_KINDS } from "@/lib/security/types";

// Zod schemas for the Security module. All LLM/user/API input crosses these
// before touching the database — never trust the raw request body.

export const securityPolicyKindSchema = z.enum(SECURITY_POLICY_KINDS);

// A policy patch: toggle enabled and/or replace its opaque config object.
// config is an arbitrary JSON object; each control interprets its own shape.
export const patchSecurityPolicySchema = z
  .object({
    kind: securityPolicyKindSchema,
    enabled: z.boolean().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.config !== undefined, {
    message: "Provide `enabled` and/or `config` to update.",
  });

export type PatchSecurityPolicyInput = z.infer<typeof patchSecurityPolicySchema>;

// Validates an IPv4 or IPv6 CIDR range, e.g. "10.0.0.0/8" or "2001:db8::/32".
// Kept as a hand-rolled check (no external dep) — validates structure and the
// numeric bounds of each octet / prefix length.
function isValidCidr(value: string): boolean {
  const parts = value.split("/");
  if (parts.length !== 2) return false;
  const [addr, prefixRaw] = parts;
  const prefix = Number(prefixRaw);
  if (!Number.isInteger(prefix)) return false;

  if (addr.includes(":")) {
    // IPv6: prefix 0..128, each hextet 0..ffff, allow one "::" compression.
    if (prefix < 0 || prefix > 128) return false;
    const doubleColon = addr.split("::");
    if (doubleColon.length > 2) return false;
    const hextets = addr.split(/:+/).filter((h) => h.length > 0);
    if (hextets.length === 0 && addr !== "::") return false;
    return hextets.every((h) => /^[0-9a-fA-F]{1,4}$/.test(h));
  }

  // IPv4: prefix 0..32, four octets 0..255.
  if (prefix < 0 || prefix > 32) return false;
  const octets = addr.split(".");
  if (octets.length !== 4) return false;
  return octets.every((o) => {
    if (!/^\d{1,3}$/.test(o)) return false;
    const n = Number(o);
    return n >= 0 && n <= 255;
  });
}

export const cidrSchema = z
  .string()
  .trim()
  .min(1, "Enter a CIDR range.")
  .max(64, "CIDR range is too long.")
  .refine(isValidCidr, "Enter a valid IPv4 or IPv6 CIDR (e.g. 10.0.0.0/8).");

export const createIpAllowlistSchema = z.object({
  cidr: cidrSchema,
  note: z
    .string()
    .trim()
    .max(200, "Note is too long.")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type CreateIpAllowlistInput = z.infer<typeof createIpAllowlistSchema>;

// ---------------------------------------------------------------------------
// Threat-detection ("XDR") read API. The severity query filter is validated
// against the fixed enum so an invalid value fails fast (400) rather than
// silently returning everything or reaching the DB with junk input.
// ---------------------------------------------------------------------------

export const SECURITY_EVENT_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export const securityEventsQuerySchema = z.object({
  severity: z.enum(SECURITY_EVENT_SEVERITIES).optional(),
});

export type SecurityEventsQuery = z.infer<typeof securityEventsQuerySchema>;

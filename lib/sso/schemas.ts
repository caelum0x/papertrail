import { z } from "zod";

// Zod schemas for the SSO / SCIM / MFA API boundary. Every LLM-free structured
// input crossing an API route is validated here before use (project convention:
// never trust raw JSON.parse). The provider-specific SSO `config` object is
// validated separately against its protocol field metadata (see config.ts).

export const ssoProtocolEnum = z.enum(["saml", "oidc"]);
export const ssoStatusEnum = z.enum(["draft", "active", "disabled"]);

export const createSsoConnectionSchema = z.object({
  protocol: ssoProtocolEnum,
  name: z.string().trim().min(1, "A name is required.").max(120),
  domain: z
    .string()
    .trim()
    .max(255)
    .regex(
      /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i,
      "Enter a valid domain (e.g. lab.example.edu)."
    )
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type CreateSsoConnectionInput = z.infer<typeof createSsoConnectionSchema>;

export const updateSsoConnectionSchema = z
  .object({
    name: z.string().trim().min(1, "A name is required.").max(120).optional(),
    status: ssoStatusEnum.optional(),
    domain: z
      .string()
      .trim()
      .max(255)
      .regex(
        /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i,
        "Enter a valid domain (e.g. lab.example.edu)."
      )
      .optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.status !== undefined ||
      v.domain !== undefined ||
      v.config !== undefined,
    { message: "Provide at least one field to update." }
  );

export type UpdateSsoConnectionInput = z.infer<typeof updateSsoConnectionSchema>;

// SCIM directory creation. Name is optional; the bearer token is generated
// server-side, never accepted from the client.
export const createScimDirectorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

export type CreateScimDirectoryInput = z.infer<typeof createScimDirectorySchema>;

// MFA enrollment: only TOTP is enrollable via this endpoint (recovery codes are
// derived, not enrolled directly).
export const enrollMfaSchema = z.object({
  type: z.literal("totp").default("totp"),
});

export type EnrollMfaInput = z.infer<typeof enrollMfaSchema>;

export const verifyMfaSchema = z.object({
  factorId: z.string().uuid("A valid factor id is required."),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
});

export type VerifyMfaInput = z.infer<typeof verifyMfaSchema>;

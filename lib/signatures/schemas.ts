import { z } from "zod";
import { ENTITY_TYPES, REQUEST_STATUSES } from "@/lib/signatures/types";

// Boundary validation for the signature-requests API. Never trust request
// bodies or query strings — parse them through these schemas first.

const entityTypeValues = ENTITY_TYPES as readonly string[];

export const createRequestSchema = z.object({
  entityType: z
    .string()
    .min(1)
    .max(60)
    .refine((v) => entityTypeValues.includes(v) || /^[a-z0-9_.-]+$/.test(v), {
      message: "entityType must be a known type or a lowercase slug.",
    }),
  entityId: z.string().uuid("entityId must be a valid uuid."),
  title: z.string().min(1, "A title is required.").max(300),
  // Optional initial signers, applied in the given order.
  signerUserIds: z
    .array(z.string().uuid("Each signer must be a valid user id."))
    .max(50)
    .optional()
    .default([])
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate signer in the list.",
          });
        }
        seen.add(id);
      }
    }),
});

export const listRequestsQuerySchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  entityType: z.string().min(1).max(60).optional(),
});

// Adding signers to an existing (draft/pending) request. Signers are appended
// after the current highest order_index in the order provided.
export const addSignersSchema = z.object({
  signerUserIds: z
    .array(z.string().uuid("Each signer must be a valid user id."))
    .min(1, "Provide at least one signer.")
    .max(50)
    .superRefine((ids, ctx) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Duplicate signer in the list.",
          });
        }
        seen.add(id);
      }
    }),
});

// Signing requires a non-empty "MFA meaning" string: a human-readable assertion
// of how the signer re-authenticated (e.g. "TOTP verified", "WebAuthn key").
// This is recorded on the audit trail and folded into the certificate hash.
export const signSchema = z.object({
  mfaMethod: z
    .string()
    .min(1, "An MFA method is required to sign.")
    .max(120),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type AddSignersInput = z.infer<typeof addSignersSchema>;
export type SignInput = z.infer<typeof signSchema>;

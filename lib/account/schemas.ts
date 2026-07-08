import { z } from "zod";

// Zod schemas for every mutating /api/account/* boundary. Nothing untrusted is
// used before it passes through one of these. All are `.strict()` so unknown /
// misspelled keys surface as validation errors rather than being silently
// dropped into a jsonb blob or ignored.

// PATCH /api/account/profile — any subset of editable profile fields. Fields are
// nullable so a caller can clear them; omitted fields are left untouched.
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    display_name: z.string().trim().max(120).nullable().optional(),
    title: z.string().trim().max(120).nullable().optional(),
    avatar_url: z.string().trim().url().max(2048).nullable().optional(),
  })
  .strict();
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// PATCH /api/account/password — change own password. Requires the current
// password (verified server-side) plus a new one meeting the same policy as
// registration (8..200 chars). confirm must match new_password.
export const updatePasswordSchema = z
  .object({
    current_password: z.string().min(1).max(200),
    new_password: z.string().min(8, "New password must be at least 8 characters.").max(200),
    confirm_password: z.string().min(1).max(200),
  })
  .strict()
  .refine((v) => v.new_password === v.confirm_password, {
    message: "New password and confirmation do not match.",
    path: ["confirm_password"],
  })
  .refine((v) => v.new_password !== v.current_password, {
    message: "New password must be different from the current password.",
    path: ["new_password"],
  });
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

// POST /api/account/tokens — mint a new personal access token. Only a name is
// needed; the secret is generated server-side and returned once.
export const createTokenSchema = z
  .object({
    name: z.string().trim().min(1, "Give the token a name.").max(120),
  })
  .strict();
export type CreateTokenInput = z.infer<typeof createTokenSchema>;

// PATCH /api/account/preferences — any subset of the known preference keys.
export const updatePreferencesSchema = z
  .object({
    theme: z.enum(["system", "light", "dark"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    landing_view: z.enum(["dashboard", "claims", "reports"]).optional(),
    email_digest: z.boolean().optional(),
    reduced_motion: z.boolean().optional(),
  })
  .strict();
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

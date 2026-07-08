import { z } from "zod";
import type { Role } from "@/lib/authz/rbac";

// Zod schemas for all org & team management request bodies. Every route
// validates its input against one of these before touching the database.

// Mirror lib/authz/rbac.ts ROLES as a typed tuple so parsed values narrow to Role.
const roleEnum = z.enum(["owner", "admin", "editor", "viewer"]);
// Compile-time guard: the enum values must exactly equal the Role union.
type _RoleCheck = Role extends z.infer<typeof roleEnum>
  ? z.infer<typeof roleEnum> extends Role
    ? true
    : never
  : never;
const _roleCheck: _RoleCheck = true;
void _roleCheck;

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required."),
  role: roleEnum.default("viewer"),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const createMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required."),
  role: roleEnum.default("viewer"),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z.object({
  role: roleEnum,
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const updateOrgSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Slug is required.")
      .max(64)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug may only contain lowercase letters, numbers, and hyphens."
      )
      .optional(),
    default_member_role: roleEnum.optional(),
    require_review: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No fields to update.",
  });
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;

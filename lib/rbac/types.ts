import { z } from "zod";
import { isValidPermission } from "@/lib/rbac/catalog";

// Domain types + Zod schemas for the RBAC & teams module. All structured input
// is validated against these before touching the database.

export interface CustomRole {
  id: string;
  orgId: string;
  name: string;
  permissions: string[];
  createdAt: string;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  orgId: string;
  teamId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  createdAt: string;
}

export interface PermissionGrant {
  id: string;
  orgId: string;
  subjectType: "user" | "team" | "role";
  subjectId: string;
  resource: string;
  action: string;
  createdAt: string;
}

const permissionArray = z
  .array(z.string())
  .max(200, "Too many permissions.")
  .refine(
    (perms) => perms.every((p) => isValidPermission(p)),
    "One or more permissions are not recognized."
  );

const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(80, "Name must be 80 characters or fewer.");

export const createRoleSchema = z.object({
  name: nameSchema,
  permissions: permissionArray.default([]),
});

export const updateRoleSchema = z
  .object({
    name: nameSchema.optional(),
    permissions: permissionArray.optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.permissions !== undefined,
    "Nothing to update."
  );

export const createTeamSchema = z.object({
  name: nameSchema,
  description: z
    .string()
    .trim()
    .max(280, "Description must be 280 characters or fewer.")
    .optional(),
});

export const updateTeamSchema = z
  .object({
    name: nameSchema.optional(),
    description: z
      .string()
      .trim()
      .max(280, "Description must be 280 characters or fewer.")
      .nullable()
      .optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.description !== undefined,
    "Nothing to update."
  );

export const addMemberSchema = z.object({
  userId: z.string().uuid("A valid user id is required."),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;

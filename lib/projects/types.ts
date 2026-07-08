import { z } from "zod";
import { ROLES } from "@/lib/authz/rbac";

// Domain types and validation schemas for the Projects module. All LLM-free,
// but we still validate every request body at the API boundary with zod.

export type ProjectStatus = "active" | "archived";

export interface Project {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: (typeof ROLES)[number];
  name: string | null;
  email: string;
  createdAt: string;
}

export const PROJECT_STATUSES: readonly ProjectStatus[] = ["active", "archived"];

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "No fields to update.",
  });

export const addMemberSchema = z.object({
  userId: z.string().uuid("A valid user id is required."),
  role: z.enum(["owner", "admin", "editor", "viewer"]).default("editor"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;

// Client mirror of the Project/ProjectMember shapes the API returns. Kept
// separate from lib/projects/types so page bundles don't pull in zod/pg.

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
  role: "owner" | "admin" | "editor" | "viewer";
  name: string | null;
  email: string;
  createdAt: string;
}

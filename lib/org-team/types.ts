import type { Role } from "@/lib/authz/rbac";

// Shared response shapes for the org & team management module. Kept separate
// from route files so both API handlers and client pages can import them.

export interface Member {
  id: string; // membership id
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  token: string;
  invitedBy: string | null;
  inviterName: string | null;
  acceptedAt: string | null;
  createdAt: string;
  pending: boolean;
}

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  defaultMemberRole: Role;
  requireReview: boolean;
  createdAt: string;
  updatedAt: string;
}

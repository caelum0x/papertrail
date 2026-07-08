// Shared types for the team module presentational components.

export interface Member {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  inviterName: string | null;
  createdAt: string;
  pending: boolean;
}

export const ROLE_OPTIONS = ["viewer", "editor", "admin", "owner"] as const;

// Role-based access control. Roles are ordered owner > admin > editor > viewer.
// can() checks an action against a coarse capability matrix; requireRole()
// enforces a minimum role level and throws a 403-mapped error otherwise.

export type Role = "owner" | "admin" | "editor" | "viewer";

export const ROLES: readonly Role[] = ["owner", "admin", "editor", "viewer"];

// Higher number = more privilege.
const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

// Minimum role required for each action. Actions not listed default to editor.
const ACTION_MIN_ROLE: Record<string, Role> = {
  // read-only
  "read": "viewer",
  "view": "viewer",
  "list": "viewer",
  "export": "viewer",
  // content mutation
  "create": "editor",
  "update": "editor",
  "delete": "editor",
  "verify": "editor",
  "review": "editor",
  // org administration
  "invite": "admin",
  "manage_members": "admin",
  "manage_api_keys": "admin",
  "manage_settings": "admin",
  "view_audit": "admin",
  // ownership-only
  "delete_org": "owner",
  "transfer_ownership": "owner",
  "manage_billing": "owner",
};

export interface RbacError extends Error {
  status: number;
}

function forbidden(message: string): RbacError {
  const err = new Error(message) as RbacError;
  err.status = 403;
  err.name = "ForbiddenError";
  return err;
}

export function can(role: Role, action: string): boolean {
  const min = ACTION_MIN_ROLE[action] ?? "editor";
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function hasRoleAtLeast(role: Role, minRole: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

// Throws a 403-mapped error if ctx.role is below minRole. Accepts anything with
// a `role` field so it composes with the handler Ctx without a hard import.
export function requireRole(ctx: { role: Role }, minRole: Role): void {
  if (!hasRoleAtLeast(ctx.role, minRole)) {
    throw forbidden(`Requires ${minRole} role or higher.`);
  }
}

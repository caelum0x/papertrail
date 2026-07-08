// Client-safe copy of the permission catalog shape helpers. The server owns the
// authoritative catalog in lib/rbac/catalog.ts; these helpers just format and
// split "resource:action" keys for display in client components.

export function permissionKey(resource: string, action: string): string {
  return `${resource}:${action}`;
}

export function splitPermission(
  permission: string
): { resource: string; action: string } | null {
  const idx = permission.indexOf(":");
  if (idx <= 0) return null;
  return { resource: permission.slice(0, idx), action: permission.slice(idx + 1) };
}

const ACTION_LABELS: Record<string, string> = {
  read: "Read",
  create: "Create",
  update: "Update",
  delete: "Delete",
  manage: "Manage",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

// Client-side mirror of lib/rbac/catalog.ts RESOURCE_CATALOG. Kept in sync by
// hand; the server remains the authoritative validator, so an out-of-date entry
// here can only fail to render a checkbox, never grant an invalid permission.
export interface ClientResource {
  resource: string;
  label: string;
  actions: string[];
}

export const CLIENT_RESOURCE_CATALOG: ClientResource[] = [
  { resource: "claims", label: "Claims", actions: ["read", "create", "update", "delete"] },
  {
    resource: "verifications",
    label: "Verifications",
    actions: ["read", "create", "update", "delete"],
  },
  { resource: "reports", label: "Reports", actions: ["read", "create", "delete"] },
  { resource: "documents", label: "Documents", actions: ["read", "create", "update", "delete"] },
  { resource: "references", label: "References", actions: ["read", "create", "update", "delete"] },
  { resource: "members", label: "Members", actions: ["read", "manage"] },
  { resource: "api_keys", label: "API keys", actions: ["read", "manage"] },
  { resource: "billing", label: "Billing", actions: ["read", "manage"] },
  { resource: "audit", label: "Audit log", actions: ["read"] },
  { resource: "settings", label: "Settings", actions: ["read", "manage"] },
];

export const CLIENT_ACTIONS = ["read", "create", "update", "delete", "manage"] as const;

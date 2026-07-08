// The fine-grained permission catalog. A permission is a "resource:action"
// pair. Custom roles and permission grants are validated against this catalog
// so the UI can render a fixed matrix and the API rejects unknown permissions.

export const RESOURCES = [
  "claims",
  "verifications",
  "reports",
  "documents",
  "references",
  "members",
  "api_keys",
  "billing",
  "audit",
  "settings",
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["read", "create", "update", "delete", "manage"] as const;

export type Action = (typeof ACTIONS)[number];

export interface ResourceMeta {
  resource: Resource;
  label: string;
  // Actions that make sense for this resource (subset of ACTIONS).
  actions: Action[];
}

// Human-friendly labels + the applicable actions per resource. Drives the
// PermissionGrid / PermissionMatrix UIs and matrix API response.
export const RESOURCE_CATALOG: ResourceMeta[] = [
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

const RESOURCE_SET = new Set<string>(RESOURCES);
const ACTION_SET = new Set<string>(ACTIONS);

const ALLOWED_PAIRS = new Set<string>(
  RESOURCE_CATALOG.flatMap((r) => r.actions.map((a) => `${r.resource}:${a}`))
);

export function permissionKey(resource: string, action: string): string {
  return `${resource}:${action}`;
}

export function parsePermission(
  permission: string
): { resource: string; action: string } | null {
  const idx = permission.indexOf(":");
  if (idx <= 0) return null;
  const resource = permission.slice(0, idx);
  const action = permission.slice(idx + 1);
  if (!RESOURCE_SET.has(resource) || !ACTION_SET.has(action)) return null;
  return { resource, action };
}

// True only for resource:action pairs that appear in the catalog.
export function isValidPermission(permission: string): boolean {
  return ALLOWED_PAIRS.has(permission);
}

// Filters an arbitrary list down to catalog-valid, de-duplicated permissions.
export function normalizePermissions(permissions: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of permissions) {
    if (isValidPermission(p) && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out.sort();
}

export function isValidResource(resource: string): resource is Resource {
  return RESOURCE_SET.has(resource);
}

export function isValidAction(action: string): action is Action {
  return ACTION_SET.has(action);
}

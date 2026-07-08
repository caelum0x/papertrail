"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiSend, type CustomRoleDTO } from "./api";
import { PermissionGrid } from "./PermissionGrid";
import { CLIENT_RESOURCE_CATALOG, permissionKey } from "./catalog";

interface RoleEditorProps {
  // When present, the editor is in edit mode and PATCHes this role.
  role?: CustomRoleDTO;
}

// FORM: create or edit a custom role. Composes a name field-group and the
// PermissionGrid. Manages selection state and submit lifecycle.
export function RoleEditor({ role }: RoleEditorProps) {
  const router = useRouter();
  const isEdit = Boolean(role);

  const [name, setName] = useState(role?.name ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role?.permissions ?? [])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback((permission: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }, []);

  const toggleResource = useCallback((resource: string, enable: boolean) => {
    const meta = CLIENT_RESOURCE_CATALOG.find((r) => r.resource === resource);
    if (!meta) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const action of meta.actions) {
        const key = permissionKey(resource, action);
        if (enable) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }, []);

  const selectedCount = selected.size;
  const canSubmit = useMemo(() => name.trim().length >= 2 && !saving, [name, saving]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setSaving(true);
      setError(null);

      const permissions = Array.from(selected);
      const res = isEdit
        ? await apiSend<CustomRoleDTO>(`/api/roles/${role!.id}`, "PATCH", {
            name: name.trim(),
            permissions,
          })
        : await apiSend<CustomRoleDTO>("/api/roles", "POST", {
            name: name.trim(),
            permissions,
          });

      setSaving(false);
      if (!res.success) {
        setError(res.error ?? "Failed to save role.");
        return;
      }
      router.push("/console/settings/roles");
      router.refresh();
    },
    [canSubmit, isEdit, name, role, router, selected]
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="max-w-md">
        <label
          htmlFor="role-name"
          className="block text-sm font-medium text-ink/70"
        >
          Role name
        </label>
        <input
          id="role-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Reviewer"
          maxLength={80}
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink/70">Permissions</h2>
          <span className="text-xs text-ink/40">{selectedCount} selected</span>
        </div>
        <PermissionGrid
          selected={selected}
          onToggle={toggle}
          onToggleResource={toggleResource}
          disabled={saving}
        />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create role"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/console/settings/roles")}
          className="rounded-md border border-ink/15 bg-white px-4 py-2 text-sm text-ink/70 hover:bg-paper"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

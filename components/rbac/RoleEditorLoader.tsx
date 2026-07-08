"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, type CustomRoleDTO } from "./api";
import { RoleEditor } from "./RoleEditor";

// Fetches a single role by id then hands it to RoleEditor. Provides the
// loading/error states the edit page needs before the form can render.
export function RoleEditorLoader({ roleId }: { roleId: string }) {
  const [role, setRole] = useState<CustomRoleDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiGet<CustomRoleDTO>(`/api/roles/${roleId}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load role.");
      setLoading(false);
      return;
    }
    setRole(res.data);
    setLoading(false);
  }, [roleId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="text-sm text-ink/40">Loading role…</div>;
  }
  if (error || !role) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error ?? "Role not found."}
      </div>
    );
  }
  return <RoleEditor role={role} />;
}

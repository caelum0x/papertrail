"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, type MatrixResponseDTO } from "./api";
import { permissionKey } from "./catalog";

// Read-only overview: for each resource row and custom-role column, shows how
// many of the resource's actions that role can perform. Complements RolesList.
export function PermissionMatrix() {
  const [matrix, setMatrix] = useState<MatrixResponseDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiGet<MatrixResponseDTO>("/api/permissions/matrix");
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load permission matrix.");
      setLoading(false);
      return;
    }
    setMatrix(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <section className="rounded-lg border border-ink/10 bg-white p-6 text-sm text-ink/40">
        Loading permission matrix…
      </section>
    );
  }
  if (error) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </section>
    );
  }
  if (!matrix) return null;

  const roleSets = matrix.roles.map((r) => ({
    ...r,
    set: new Set(r.permissions),
  }));

  return (
    <section className="rounded-lg border border-ink/10 bg-white">
      <div className="border-b border-ink/10 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink/70">Permission coverage</h2>
        <p className="mt-0.5 text-xs text-ink/40">
          Count of granted actions per resource for each custom role.
        </p>
      </div>
      {matrix.roles.length === 0 ? (
        <div className="p-6 text-sm text-ink/40">
          No custom roles to compare yet.
        </div>
      ) : (
        <div className="overflow-x-auto p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-ink/60">
                <th className="px-4 py-2 font-medium">Resource</th>
                {roleSets.map((r) => (
                  <th key={r.id} className="px-4 py-2 text-center font-medium">
                    {r.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/10">
              {matrix.resources.map((resource) => (
                <tr key={resource.resource}>
                  <td className="px-4 py-2 text-ink/70">{resource.label}</td>
                  {roleSets.map((r) => {
                    const granted = resource.actions.filter((a) =>
                      r.set.has(permissionKey(resource.resource, a))
                    ).length;
                    const full = granted === resource.actions.length;
                    return (
                      <td
                        key={r.id}
                        className={`px-4 py-2 text-center ${
                          granted === 0
                            ? "text-ink/20"
                            : full
                              ? "text-accent"
                              : "text-ink/70"
                        }`}
                      >
                        {granted}/{resource.actions.length}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

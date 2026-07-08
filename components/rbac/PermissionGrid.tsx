"use client";

import { useMemo } from "react";
import {
  CLIENT_RESOURCE_CATALOG,
  actionLabel,
  permissionKey,
} from "./catalog";

// A resource×action checkbox grid. Controlled: the parent owns the selected
// permission set (a Set of "resource:action" keys) and receives toggle events.
export function PermissionGrid({
  selected,
  onToggle,
  onToggleResource,
  disabled,
}: {
  selected: Set<string>;
  onToggle: (permission: string) => void;
  onToggleResource: (resource: string, enable: boolean) => void;
  disabled?: boolean;
}) {
  const allActions = useMemo(
    () =>
      Array.from(
        new Set(CLIENT_RESOURCE_CATALOG.flatMap((r) => r.actions))
      ),
    []
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ink/10 text-left text-ink/60">
            <th className="px-4 py-2 font-medium">Resource</th>
            {allActions.map((a) => (
              <th key={a} className="px-3 py-2 text-center font-medium">
                {actionLabel(a)}
              </th>
            ))}
            <th className="px-3 py-2 text-center font-medium">All</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink/10">
          {CLIENT_RESOURCE_CATALOG.map((resource) => {
            const resourceKeys = resource.actions.map((a) =>
              permissionKey(resource.resource, a)
            );
            const allChecked = resourceKeys.every((k) => selected.has(k));
            return (
              <tr key={resource.resource}>
                <td className="px-4 py-2 text-ink/70">{resource.label}</td>
                {allActions.map((action) => {
                  const applicable = resource.actions.includes(action);
                  const key = permissionKey(resource.resource, action);
                  return (
                    <td key={action} className="px-3 py-2 text-center">
                      {applicable ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                          checked={selected.has(key)}
                          disabled={disabled}
                          onChange={() => onToggle(key)}
                          aria-label={`${resource.label} ${actionLabel(action)}`}
                        />
                      ) : (
                        <span className="text-ink/15">–</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={allChecked}
                    disabled={disabled}
                    onChange={() =>
                      onToggleResource(resource.resource, !allChecked)
                    }
                    aria-label={`Toggle all ${resource.label} permissions`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

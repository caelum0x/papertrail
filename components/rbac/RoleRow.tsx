"use client";

import Link from "next/link";
import type { CustomRoleDTO } from "./api";

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

// A single row in the RolesList table. Delete is delegated to the parent so the
// list can manage optimistic state + confirmation.
export function RoleRow({
  role,
  onDelete,
  deleting,
}: {
  role: CustomRoleDTO;
  onDelete: (role: CustomRoleDTO) => void;
  deleting: boolean;
}) {
  return (
    <tr className="hover:bg-paper/60">
      <td className="px-4 py-3">
        <Link
          href={`/console/settings/roles/${role.id}`}
          className="font-medium text-ink/80 hover:text-accent hover:underline"
        >
          {role.name}
        </Link>
      </td>
      <td className="px-4 py-3 text-ink/60">
        {role.permissions.length}{" "}
        {role.permissions.length === 1 ? "permission" : "permissions"}
      </td>
      <td className="px-4 py-3 text-ink/40">{formatDate(role.createdAt)}</td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/console/settings/roles/${role.id}`}
          className="text-sm text-accent hover:underline"
        >
          Edit
        </Link>
        <button
          type="button"
          onClick={() => onDelete(role)}
          disabled={deleting}
          className="ml-4 text-sm text-red-600 hover:underline disabled:opacity-40"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </td>
    </tr>
  );
}

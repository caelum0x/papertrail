"use client";

import Link from "next/link";
import type { Dashboard } from "./types";
import { formatDateTime } from "./shared";

interface DashboardListProps {
  dashboards: Dashboard[];
  canEdit: boolean;
  onDelete: (id: string) => void;
}

// Table of the org's dashboards. Rows link to the detail view; editors may delete.
export function DashboardList({ dashboards, canEdit, onDelete }: DashboardListProps) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-ink/15 text-xs uppercase tracking-wide text-ink/40">
        <tr>
          <th className="px-4 py-2 font-medium">Name</th>
          <th className="px-4 py-2 font-medium">Widgets</th>
          <th className="px-4 py-2 font-medium">Created by</th>
          <th className="px-4 py-2 font-medium">Created</th>
          <th className="px-4 py-2 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink/10">
        {dashboards.map((d) => (
          <DashboardRow
            key={d.id}
            dashboard={d}
            canEdit={canEdit}
            onDelete={onDelete}
          />
        ))}
      </tbody>
    </table>
  );
}

interface DashboardRowProps {
  dashboard: Dashboard;
  canEdit: boolean;
  onDelete: (id: string) => void;
}

function DashboardRow({ dashboard, canEdit, onDelete }: DashboardRowProps) {
  return (
    <tr className="hover:bg-paper">
      <td className="px-4 py-2.5">
        <Link
          href={`/console/dashboards/${dashboard.id}`}
          className="font-medium text-ink/80 hover:text-accent"
        >
          {dashboard.name}
        </Link>
        {dashboard.is_default ? (
          <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
            Default
          </span>
        ) : null}
      </td>
      <td className="px-4 py-2.5 text-ink/60 tabular-nums">
        {dashboard.widget_count}
      </td>
      <td className="px-4 py-2.5 text-ink/60">
        {dashboard.created_by_name ?? dashboard.created_by_email ?? "—"}
      </td>
      <td className="px-4 py-2.5 text-ink/50">
        {formatDateTime(dashboard.created_at)}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-3">
          <Link
            href={`/console/dashboards/${dashboard.id}/edit`}
            className="text-ink/50 hover:text-accent"
          >
            Edit
          </Link>
          {canEdit ? (
            <button
              onClick={() => onDelete(dashboard.id)}
              className="text-red-700/70 hover:text-red-700"
            >
              Delete
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

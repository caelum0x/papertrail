"use client";

import type { Dashboard } from "../client";
import { SaveDashboardForm } from "./SaveDashboardForm";
import { DashboardsTable } from "./DashboardsTable";

interface SavedDashboardsProps {
  dashboards: Dashboard[];
  dashTotal: number;
  dashLoading: boolean;
  pageSize: number;
  name: string;
  saving: boolean;
  saveError: string | null;
  onNameChange: (name: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onDelete: (id: string) => void;
}

// "Saved dashboards" section: header, save form, and the dashboards table with
// its own loading / empty states.
export function SavedDashboards({
  dashboards,
  dashTotal,
  dashLoading,
  pageSize,
  name,
  saving,
  saveError,
  onNameChange,
  onSubmit,
  onDelete,
}: SavedDashboardsProps) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-ink/80">Saved dashboards</h2>
      <p className="mt-1 text-xs text-ink/40">
        Save the current analytics view to revisit it later.
      </p>

      <SaveDashboardForm
        name={name}
        saving={saving}
        saveError={saveError}
        onNameChange={onNameChange}
        onSubmit={onSubmit}
      />

      <div className="mt-3 overflow-hidden rounded-lg border border-ink/10 bg-white">
        {dashLoading ? (
          <div className="p-6 text-center text-sm text-ink/40">
            Loading dashboards…
          </div>
        ) : dashboards.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink/40">
            No saved dashboards yet.
          </div>
        ) : (
          <DashboardsTable dashboards={dashboards} onDelete={onDelete} />
        )}
      </div>
      {dashTotal > pageSize ? (
        <p className="mt-2 text-xs text-ink/40">
          Showing {dashboards.length} of {dashTotal} dashboards.
        </p>
      ) : null}
    </section>
  );
}

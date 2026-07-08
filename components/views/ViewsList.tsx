"use client";

import type { SavedViewDto } from "./api";
import { ViewRow } from "./ViewRow";

interface ViewsListProps {
  views: SavedViewDto[];
  deletingId: string | null;
  onDelete: (view: SavedViewDto) => void;
}

// The saved-views table. Renders a <ViewRow/> per view; the parent owns loading,
// empty, and error states so this component only concerns itself with layout.
export function ViewsList({ views, deletingId, onDelete }: ViewsListProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
      <table className="w-full">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-ink/40">
            <th className="px-4 py-2 font-medium">View</th>
            <th className="px-4 py-2 font-medium">Resource</th>
            <th className="px-4 py-2 font-medium">Visibility</th>
            <th className="px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {views.map((view) => (
            <ViewRow
              key={view.id}
              view={view}
              deletingId={deletingId}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

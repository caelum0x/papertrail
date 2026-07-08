"use client";

import type { AuditFilterOptions } from "./types";

interface AuditFiltersProps {
  filters: AuditFilterOptions;
  action: string;
  entityType: string;
  userId: string;
  onActionChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onEntityTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onUserIdChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  onClear: () => void;
}

const SELECT_CLS =
  "text-sm border border-ink/15 rounded px-2 py-2 bg-white focus:outline-none focus:border-accent";

// Filter bar for the audit log: action / entity type / user selectors plus a
// clear-filters action.
export function AuditFilters({
  filters,
  action,
  entityType,
  userId,
  onActionChange,
  onEntityTypeChange,
  onUserIdChange,
  onClear,
}: AuditFiltersProps) {
  const hasFilters = Boolean(action || entityType || userId);

  return (
    <div className="mt-6 flex flex-wrap gap-3">
      <select
        value={action}
        onChange={onActionChange}
        className={SELECT_CLS}
        aria-label="Filter by action"
      >
        <option value="">All actions</option>
        {filters.actions.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <select
        value={entityType}
        onChange={onEntityTypeChange}
        className={SELECT_CLS}
        aria-label="Filter by entity type"
      >
        <option value="">All entities</option>
        {filters.entityTypes.map((e) => (
          <option key={e} value={e}>
            {e}
          </option>
        ))}
      </select>
      <select
        value={userId}
        onChange={onUserIdChange}
        className={SELECT_CLS}
        aria-label="Filter by user"
      >
        <option value="">All users</option>
        {filters.users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name ?? u.email}
          </option>
        ))}
      </select>
      {hasFilters ? (
        <button onClick={onClear} className="text-sm text-accent hover:underline">
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

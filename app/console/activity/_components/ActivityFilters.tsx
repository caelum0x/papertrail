"use client";

import type { CollabEntityType } from "@/components/collaboration/client";
import { ENTITY_FILTERS, VERB_FILTERS } from "./filters";
import { FilterChips } from "./FilterChips";

interface ActivityFiltersProps {
  entityType: "" | CollabEntityType;
  verb: string;
  onEntityChange: (value: "" | CollabEntityType) => void;
  onVerbChange: (value: string) => void;
}

// Combined entity + verb chip filters for the org-wide activity feed.
export function ActivityFilters({
  entityType,
  verb,
  onEntityChange,
  onVerbChange,
}: ActivityFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <FilterChips
        options={ENTITY_FILTERS}
        value={entityType}
        onChange={onEntityChange}
        keyPrefix="all"
      />
      <span className="text-ink/20">·</span>
      <FilterChips
        options={VERB_FILTERS}
        value={verb}
        onChange={onVerbChange}
        keyPrefix="all-verbs"
      />
    </div>
  );
}

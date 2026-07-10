"use client";

import { useCallback, useState } from "react";
import { SourcePicker } from "@/components/sources/SourcePicker";

// Workbench wrapper around the reusable SourcePicker. It composes the picker and
// exposes the currently selected cached-source ids to the workbench page via
// onSelectionChange, so the reviewer can build a source set by searching instead
// of pasting raw UUIDs. The actual call into /api/auto-synthesis is wired by the
// workbench page in the integration phase — this component only owns selection.

export interface SourceSearchProps {
  // Reports the selected cached-source ids up to the workbench page.
  onSelectionChange: (selectedSourceIds: string[]) => void;
  // Optional initial selection (source ids) to seed the picker.
  initialSelectedIds?: string[];
  // Optional cap forwarded to the picker (e.g. keep pooled sets manageable).
  maxSelected?: number;
}

export function SourceSearch({
  onSelectionChange,
  initialSelectedIds,
  maxSelected,
}: SourceSearchProps) {
  const [count, setCount] = useState(
    () => new Set(initialSelectedIds ?? []).size
  );

  const handleChange = useCallback(
    (ids: string[]) => {
      setCount(ids.length);
      onSelectionChange(ids);
    },
    [onSelectionChange]
  );

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink/80">
          Pick cached sources
        </h3>
        <p className="mt-0.5 text-xs text-ink/40">
          Search PubMed and ClinicalTrials.gov rows already ingested into the
          cache and multi-select the studies to pool. No UUIDs required.
        </p>
      </div>

      <SourcePicker
        onChange={handleChange}
        initialSelectedIds={initialSelectedIds}
        maxSelected={maxSelected}
        label="Search cached sources"
      />

      {count === 0 ? (
        <p className="text-xs text-ink/40">
          Select at least one source to run auto-synthesis.
        </p>
      ) : null}
    </div>
  );
}

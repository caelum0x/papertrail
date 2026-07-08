"use client";

import { VIEW_RESOURCES, RESOURCE_LABELS, type ViewResource } from "./api";

interface ResourceFilterProps {
  value: ViewResource | "all";
  onChange: (value: ViewResource | "all") => void;
}

// Segmented resource selector for the list page. "All" clears the filter; each
// pill scopes the list to one resource type.
export function ResourceFilter({ value, onChange }: ResourceFilterProps) {
  const options: readonly (ViewResource | "all")[] = ["all", ...VIEW_RESOURCES];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((option) => {
        const label = option === "all" ? "All" : RESOURCE_LABELS[option];
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={`text-sm rounded-full px-3 py-1 border ${
              active
                ? "bg-accent text-white border-accent"
                : "bg-white text-ink/60 border-ink/15 hover:border-accent"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import type { LabExperimentListItem } from "./types";

// The saved-experiment list: a full-text search box plus cards. The parent owns the query
// value and the list data (loading/empty/error), so this stays presentational.

interface ExperimentListProps {
  items: LabExperimentListItem[];
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
  loading: boolean;
  error: string | null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function ExperimentCard({
  item,
  selected,
  onSelect,
}: {
  item: LabExperimentListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={`w-full rounded-lg border bg-white p-3 text-left transition ${
        selected ? "border-accent" : "border-ink/15 hover:border-ink/30"
      }`}
    >
      <h4 className="text-sm font-medium text-ink/80">{item.title}</h4>
      <p className="mt-1 text-xs text-ink/40">
        {item.experimentDate ? `${item.experimentDate} · ` : ""}
        saved {formatDate(item.createdAt)}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink/50">
        <span>{item.stepCount} steps</span>
        <span>{item.reagentCount} reagents</span>
        <span>{item.outcomeCount} outcomes</span>
      </div>
      {item.tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.slice(0, 5).map((t, i) => (
            <span
              key={`${t}-${i}`}
              className="rounded-full bg-ink/[0.05] px-2 py-0.5 text-[10px] text-ink/60"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}

export function ExperimentList({
  items,
  query,
  onQueryChange,
  onSelect,
  selectedId,
  loading,
  error,
}: ExperimentListProps) {
  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search saved experiments…"
        className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
      />

      {error ? (
        <p className="rounded-md border border-ink/15 bg-white p-3 text-sm text-red-700">
          {error}
        </p>
      ) : loading ? (
        <p className="rounded-md border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
          Loading experiments…
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
          {query.trim()
            ? "No experiments match your search."
            : "No saved experiments yet. Structure some notes to get started."}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <ExperimentCard
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

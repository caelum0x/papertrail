"use client";

import { ENTITY_COLORS, ENTITY_LABELS, type EntityType } from "./types";

// Small legend mapping node colour → entity type, plus headline graph stats.

const ORDER: EntityType[] = ["drug", "condition", "population", "outcome", "trial"];

interface LegendProps {
  stats: {
    source_count: number;
    node_count: number;
    edge_count: number;
    grounded_relation_count: number;
    dropped_relation_count: number;
  };
}

export function Legend({ stats }: LegendProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-ink/10 bg-white px-4 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        {ORDER.map((t) => (
          <span key={t} className="flex items-center gap-1.5 text-ink/60">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ENTITY_COLORS[t] }} />
            {ENTITY_LABELS[t]}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-ink/50">
        <span>{stats.node_count} entities</span>
        <span>{stats.edge_count} relations</span>
        <span>{stats.source_count} sources</span>
        <span className="text-accent">{stats.grounded_relation_count} grounded</span>
        {stats.dropped_relation_count > 0 ? (
          <span title="Relations Claude proposed that could not be grounded to a source sentence and were dropped.">
            {stats.dropped_relation_count} dropped
          </span>
        ) : null}
      </div>
    </div>
  );
}

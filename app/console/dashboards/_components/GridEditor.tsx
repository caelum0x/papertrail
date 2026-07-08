"use client";

import type { DashboardLayout, DashboardWidget, ResolvedWidget } from "./types";
import { WidgetCard } from "./WidgetCard";
import { EmptyState } from "./EmptyState";
import { WIDGET_KIND_LABELS } from "./shared";

interface GridEditorProps {
  layout: DashboardLayout;
  widgets: DashboardWidget[];
  // Resolved preview data keyed by widget id (best-effort; may be missing).
  resolved: Map<string, ResolvedWidget>;
  selectedId: string | null;
  onSelect: (widgetId: string) => void;
  onRemove: (widgetId: string) => void;
}

// Editable grid: each tile is selectable (opens the config panel) and removable.
// Shows a live preview from resolved data when available, else a placeholder.
export function GridEditor({
  layout,
  widgets,
  resolved,
  selectedId,
  onSelect,
  onRemove,
}: GridEditorProps) {
  if (widgets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink/20 bg-white">
        <EmptyState
          title="Empty grid"
          description="Add a widget from the palette on the left to get started."
        />
      </div>
    );
  }

  const columns = Math.min(Math.max(layout.columns, 1), 12);

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: `${layout.gap}px`,
      }}
    >
      {widgets.map((widget) => {
        const preview = resolved.get(widget.id);
        const selected = widget.id === selectedId;
        return (
          <div
            key={widget.id}
            className={`rounded-lg ring-2 ${
              selected ? "ring-accent" : "ring-transparent"
            }`}
          >
            {preview ? (
              <WidgetCard
                widget={preview}
                actions={
                  <WidgetActions
                    onSelect={() => onSelect(widget.id)}
                    onRemove={() => onRemove(widget.id)}
                  />
                }
              />
            ) : (
              <div className="flex h-full flex-col rounded-lg border border-ink/15 bg-white p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold text-ink/70">
                    {widget.config.title ?? WIDGET_KIND_LABELS[widget.kind]}
                  </h3>
                  <WidgetActions
                    onSelect={() => onSelect(widget.id)}
                    onRemove={() => onRemove(widget.id)}
                  />
                </div>
                <p className="py-4 text-center text-xs text-ink/40">
                  Configure this {WIDGET_KIND_LABELS[widget.kind].toLowerCase()} to see data.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WidgetActions({
  onSelect,
  onRemove,
}: {
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <button
        onClick={onSelect}
        className="rounded px-1.5 py-0.5 text-xs text-ink/50 hover:bg-paper hover:text-accent"
      >
        Configure
      </button>
      <button
        onClick={onRemove}
        className="rounded px-1.5 py-0.5 text-xs text-red-700/70 hover:bg-paper hover:text-red-700"
      >
        Remove
      </button>
    </>
  );
}

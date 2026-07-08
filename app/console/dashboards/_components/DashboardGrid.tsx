import type { ReactNode } from "react";
import type { DashboardLayout, ResolvedWidget } from "./types";
import { WidgetCard } from "./WidgetCard";

interface DashboardGridProps {
  layout: DashboardLayout;
  widgets: ResolvedWidget[];
  // Optional per-widget action slot (used by the editor).
  renderActions?: (widget: ResolvedWidget) => ReactNode;
}

// Renders resolved widgets in a responsive CSS grid driven by the dashboard's
// saved layout (columns + gap).
export function DashboardGrid({ layout, widgets, renderActions }: DashboardGridProps) {
  const columns = Math.min(Math.max(layout.columns, 1), 12);
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: `${layout.gap}px`,
      }}
    >
      {widgets.map((widget) => (
        <WidgetCard
          key={widget.widgetId}
          widget={widget}
          actions={renderActions ? renderActions(widget) : undefined}
        />
      ))}
    </div>
  );
}

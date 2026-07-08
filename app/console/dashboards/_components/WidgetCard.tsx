import type { ReactNode } from "react";
import type { ResolvedWidget } from "./types";
import { MetricWidget } from "./MetricWidget";
import { ListWidget } from "./ListWidget";
import { ChartWidget } from "./ChartWidget";

interface WidgetCardProps {
  widget: ResolvedWidget;
  // Optional footer / controls rendered by the grid editor (remove, configure).
  actions?: ReactNode;
}

// A framed tile that renders the correct widget body for its kind, plus a shared
// header and per-widget error fallback.
export function WidgetCard({ widget, actions }: WidgetCardProps) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-ink/15 bg-white p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-ink/70" title={widget.title}>
          {widget.title}
        </h3>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{renderBody(widget)}</div>
    </div>
  );
}

function renderBody(widget: ResolvedWidget): ReactNode {
  if (widget.error) {
    return (
      <p className="py-6 text-center text-sm text-red-700">{widget.error}</p>
    );
  }
  if (!widget.data) {
    return (
      <p className="py-6 text-center text-sm text-ink/40">
        Nothing to display.
      </p>
    );
  }
  if (widget.data.kind === "metric") return <MetricWidget data={widget.data} />;
  if (widget.data.kind === "list") return <ListWidget data={widget.data} />;
  return <ChartWidget data={widget.data} />;
}

"use client";

import { useEffect, useState } from "react";
import type { DashboardWidget, WidgetConfig } from "./types";
import {
  CHART_OPTIONS,
  LIST_OPTIONS,
  METRIC_OPTIONS,
  WIDGET_KIND_LABELS,
} from "./shared";

interface WidgetConfigPanelProps {
  widget: DashboardWidget | null;
  saving: boolean;
  onSave: (config: WidgetConfig) => void;
  onClose: () => void;
}

// Right-hand panel to configure the selected widget's metric/source/series,
// title, and kind-specific options. Local draft state commits on save.
export function WidgetConfigPanel({
  widget,
  saving,
  onSave,
  onClose,
}: WidgetConfigPanelProps) {
  const [draft, setDraft] = useState<WidgetConfig>({});

  useEffect(() => {
    setDraft(widget ? { ...widget.config } : {});
  }, [widget]);

  if (!widget) {
    return (
      <div className="rounded-lg border border-ink/15 bg-white p-4 text-sm text-ink/40">
        Select a widget to configure it.
      </div>
    );
  }

  const set = (patch: Partial<WidgetConfig>) =>
    setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink/70">
          {WIDGET_KIND_LABELS[widget.kind]} settings
        </h2>
        <button
          onClick={onClose}
          className="text-xs text-ink/40 hover:text-ink/70"
        >
          Close
        </button>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs text-ink/50">Title (optional)</span>
        <input
          value={draft.title ?? ""}
          onChange={(e) => set({ title: e.target.value || undefined })}
          maxLength={80}
          placeholder="Auto"
          className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
      </label>

      {widget.kind === "metric" ? (
        <label className="mt-3 block">
          <span className="mb-1 block text-xs text-ink/50">Metric</span>
          <select
            value={draft.metric ?? ""}
            onChange={(e) => set({ metric: e.target.value as WidgetConfig["metric"] })}
            className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          >
            <option value="">Select a metric…</option>
            {METRIC_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {widget.kind === "list" ? (
        <>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink/50">Source</span>
            <select
              value={draft.source ?? ""}
              onChange={(e) => set({ source: e.target.value as WidgetConfig["source"] })}
              className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">Select a source…</option>
              {LIST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink/50">Rows (1–50)</span>
            <input
              type="number"
              min={1}
              max={50}
              value={draft.limit ?? 5}
              onChange={(e) => set({ limit: clampInt(e.target.value, 1, 50) })}
              className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </label>
        </>
      ) : null}

      {widget.kind === "chart" ? (
        <>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink/50">Series</span>
            <select
              value={draft.series ?? ""}
              onChange={(e) => set({ series: e.target.value as WidgetConfig["series"] })}
              className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">Select a series…</option>
              {CHART_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs text-ink/50">Range (days, 1–365)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={draft.rangeDays ?? 30}
              onChange={(e) => set({ rangeDays: clampInt(e.target.value, 1, 365) })}
              className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </label>
        </>
      ) : null}

      <button
        onClick={() => onSave(draft)}
        disabled={saving}
        className="mt-4 w-full rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save widget"}
      </button>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.floor(n), min), max);
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ModuleHeader } from "../../_components/ModuleHeader";
import { WidgetPalette } from "../../_components/WidgetPalette";
import { GridEditor } from "../../_components/GridEditor";
import { WidgetConfigPanel } from "../../_components/WidgetConfigPanel";
import { useRole } from "../../_components/useRole";
import { DEFAULT_CONFIG } from "../../_components/shared";
import {
  createWidget,
  deleteWidget,
  fetchDashboard,
  fetchDashboardData,
  fetchWidgets,
  updateDashboard,
  updateWidget,
} from "../../_components/api";
import type {
  Dashboard,
  DashboardWidget,
  ResolvedWidget,
  WidgetConfig,
  WidgetKind,
} from "../../_components/types";

export default function DashboardEditPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();
  const { canEdit, loading: roleLoading } = useRole();

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [resolved, setResolved] = useState<ResolvedWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [savingWidget, setSavingWidget] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const [metaRes, widgetsRes, dataRes] = await Promise.all([
      fetchDashboard(id),
      fetchWidgets(id),
      fetchDashboardData(id),
    ]);
    if (metaRes.error || widgetsRes.error) {
      setError(metaRes.error ?? widgetsRes.error);
    } else {
      setDashboard(metaRes.data);
      setWidgets(widgetsRes.data ?? []);
      setResolved(dataRes.data?.widgets ?? []);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const resolvedMap = useMemo(() => {
    const m = new Map<string, ResolvedWidget>();
    for (const r of resolved) m.set(r.widgetId, r);
    return m;
  }, [resolved]);

  const selectedWidget = useMemo(
    () => widgets.find((w) => w.id === selectedId) ?? null,
    [widgets, selectedId]
  );

  const refreshData = useCallback(async () => {
    if (!id) return;
    const dataRes = await fetchDashboardData(id);
    setResolved(dataRes.data?.widgets ?? []);
  }, [id]);

  const onAdd = async (kind: WidgetKind) => {
    if (!id) return;
    setAdding(true);
    setNotice(null);
    const result = await createWidget(id, {
      kind,
      config: DEFAULT_CONFIG[kind] as WidgetConfig,
    });
    setAdding(false);
    if (result.error || !result.data) {
      setNotice(result.error ?? "Couldn't add widget.");
      return;
    }
    setWidgets((prev) => [...prev, result.data as DashboardWidget]);
    setSelectedId(result.data.id);
    await refreshData();
  };

  const onSaveWidget = async (config: WidgetConfig) => {
    if (!id || !selectedId) return;
    setSavingWidget(true);
    setNotice(null);
    const result = await updateWidget(id, selectedId, { config });
    setSavingWidget(false);
    if (result.error || !result.data) {
      setNotice(result.error ?? "Couldn't save widget.");
      return;
    }
    setWidgets((prev) =>
      prev.map((w) => (w.id === selectedId ? (result.data as DashboardWidget) : w))
    );
    await refreshData();
  };

  const onRemove = async (widgetId: string) => {
    if (!id) return;
    const result = await deleteWidget(id, widgetId);
    if (result.error) {
      setNotice(result.error);
      return;
    }
    setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    if (selectedId === widgetId) setSelectedId(null);
    await refreshData();
  };

  const onSaveMeta = async (patch: {
    name?: string;
    isDefault?: boolean;
    layout?: { columns: number; gap: number };
  }) => {
    if (!id) return;
    setSavingMeta(true);
    setNotice(null);
    const result = await updateDashboard(id, patch);
    setSavingMeta(false);
    if (result.error || !result.data) {
      setNotice(result.error ?? "Couldn't save dashboard.");
      return;
    }
    setDashboard(result.data);
    setNotice("Saved.");
  };

  if (!roleLoading && !canEdit) {
    return (
      <div>
        <ModuleHeader title="Edit dashboard" />
        <p className="mt-6 rounded-lg border border-ink/15 bg-white p-6 text-sm text-ink/50">
          You need editor access to edit dashboards.
        </p>
      </div>
    );
  }

  return (
    <div>
      <ModuleHeader
        title={dashboard ? `Edit · ${dashboard.name}` : "Edit dashboard"}
        actions={
          <>
            {id ? (
              <Link
                href={`/console/dashboards/${id}`}
                className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
              >
                View
              </Link>
            ) : null}
            <button
              onClick={() => router.push("/console/dashboards")}
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/60 hover:bg-paper"
            >
              Done
            </button>
          </>
        }
      />

      {notice ? (
        <p className="mt-4 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/60">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-10 text-center text-sm text-ink/40">
          Loading editor…
        </div>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-ink/15 bg-white p-10 text-center">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={load}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr_260px]">
          <div className="space-y-4">
            <WidgetPalette adding={adding} onAdd={onAdd} />
            {dashboard ? (
              <LayoutControls
                dashboard={dashboard}
                saving={savingMeta}
                onSave={onSaveMeta}
              />
            ) : null}
          </div>

          <GridEditor
            layout={dashboard?.layout ?? { columns: 3, gap: 16 }}
            widgets={widgets}
            resolved={resolvedMap}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRemove={onRemove}
          />

          <WidgetConfigPanel
            widget={selectedWidget}
            saving={savingWidget}
            onSave={onSaveWidget}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}
    </div>
  );
}

interface LayoutControlsProps {
  dashboard: Dashboard;
  saving: boolean;
  onSave: (patch: {
    name?: string;
    isDefault?: boolean;
    layout?: { columns: number; gap: number };
  }) => void;
}

// Dashboard-level settings: name, default flag, grid columns + gap.
function LayoutControls({ dashboard, saving, onSave }: LayoutControlsProps) {
  const [name, setName] = useState(dashboard.name);
  const [isDefault, setIsDefault] = useState(dashboard.is_default);
  const [columns, setColumns] = useState(dashboard.layout.columns);
  const [gap, setGap] = useState(dashboard.layout.gap);

  useEffect(() => {
    setName(dashboard.name);
    setIsDefault(dashboard.is_default);
    setColumns(dashboard.layout.columns);
    setGap(dashboard.layout.gap);
  }, [dashboard]);

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink/70">Dashboard settings</h2>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs text-ink/50">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-ink/50">Columns</span>
          <input
            type="number"
            min={1}
            max={12}
            value={columns}
            onChange={(e) => setColumns(clampInt(e.target.value, 1, 12))}
            className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink/50">Gap (px)</span>
          <input
            type="number"
            min={0}
            max={48}
            value={gap}
            onChange={(e) => setGap(clampInt(e.target.value, 0, 48))}
            className="w-full rounded-md border border-ink/15 px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink/60">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
        />
        Default dashboard
      </label>

      <button
        onClick={() =>
          onSave({ name: name.trim() || dashboard.name, isDefault, layout: { columns, gap } })
        }
        disabled={saving}
        className="mt-4 w-full rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}

function clampInt(raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(Math.floor(n), min), max);
}

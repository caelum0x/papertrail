"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createDashboard,
  deleteDashboard,
  fetchDashboards,
  fetchOverview,
  type Dashboard,
  type OverviewMetrics as OverviewMetricsData,
} from "./client";
import { StateBlock } from "./components";
import { AnalyticsHeader } from "./_components/ModuleHeader";
import { OverviewMetrics } from "./_components/OverviewMetrics";
import { SavedDashboards } from "./_components/SavedDashboards";

const PAGE_SIZE = 10;

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<OverviewMetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [dashTotal, setDashTotal] = useState(0);
  const [dashLoading, setDashLoading] = useState(true);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchOverview();
    if (result.error) {
      setError(result.error);
      setMetrics(null);
    } else {
      setMetrics(result.data);
    }
    setLoading(false);
  }, []);

  const loadDashboards = useCallback(async () => {
    setDashLoading(true);
    const result = await fetchDashboards(1, PAGE_SIZE);
    setDashboards(result.error ? [] : result.data ?? []);
    setDashTotal(result.error ? 0 : result.total);
    setDashLoading(false);
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    loadDashboards();
  }, [loadDashboards]);

  const onSaveDashboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setSaveError("Dashboard name is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    // Persist the standard overview layout under this name.
    const result = await createDashboard({
      name: name.trim(),
      config: {
        cards: [
          { kind: "kpi_claims_verified" },
          { kind: "kpi_distortion_rate" },
          { kind: "kpi_documents_processed" },
          { kind: "kpi_avg_trust" },
          { kind: "chart_distortion_by_type" },
        ],
        rangeDays: 30,
      },
    });
    setSaving(false);
    if (result.error) {
      setSaveError(result.error);
      return;
    }
    setName("");
    await loadDashboards();
  };

  const onDeleteDashboard = async (id: string) => {
    const result = await deleteDashboard(id);
    if (!result.error) await loadDashboards();
  };

  return (
    <div>
      <AnalyticsHeader active="overview" />

      {/* KPI cards */}
      <div className="mt-6">
        {loading ? (
          <StateBlock kind="loading" message="Loading analytics…" />
        ) : error ? (
          <StateBlock kind="error" message={error} onRetry={loadOverview} />
        ) : !metrics || metrics.totalVerifications === 0 ? (
          <StateBlock
            kind="empty"
            message="No verifications yet. Run a verification to populate analytics."
          />
        ) : (
          <OverviewMetrics metrics={metrics} />
        )}
      </div>

      {/* Saved dashboards */}
      <SavedDashboards
        dashboards={dashboards}
        dashTotal={dashTotal}
        dashLoading={dashLoading}
        pageSize={PAGE_SIZE}
        name={name}
        saving={saving}
        saveError={saveError}
        onNameChange={setName}
        onSubmit={onSaveDashboard}
        onDelete={onDeleteDashboard}
      />
    </div>
  );
}

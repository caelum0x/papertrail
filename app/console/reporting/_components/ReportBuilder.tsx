"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createDefinition,
  updateDefinition,
  fetchDefinition,
  runDefinition,
} from "@/lib/reporting/client";
import {
  REPORT_TYPES,
  type LayoutSection,
  type ReportFilter,
  type ReportResult,
  type ReportType,
} from "@/lib/reporting/types";
import { typeLabel } from "./format";
import { LayoutEditor } from "./LayoutEditor";
import { FilterEditor } from "./FilterEditor";
import { PreviewPanel } from "./PreviewPanel";
import { StateBlock } from "./StateBlock";

interface ReportBuilderProps {
  definitionId?: string;
  canEdit: boolean;
}

// The report builder: LayoutEditor + FilterEditor on the left, PreviewPanel on
// the right. Handles both create (no id) and edit (existing definition) flows.
export function ReportBuilder({ definitionId, canEdit }: ReportBuilderProps) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [type, setType] = useState<ReportType>("summary");
  const [sections, setSections] = useState<LayoutSection[]>([]);
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [since, setSince] = useState("");

  const [savedId, setSavedId] = useState<string | null>(definitionId ?? null);
  const [loading, setLoading] = useState(Boolean(definitionId));
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);

  const load = useCallback(async () => {
    if (!definitionId) return;
    setLoading(true);
    setLoadError(null);
    const res = await fetchDefinition(definitionId);
    if (res.error || !res.data) {
      setLoadError(res.error ?? "Report not found.");
    } else {
      setName(res.data.name);
      setType(res.data.type);
      setSections(res.data.layout.sections);
      setFilters(res.data.filters.filters);
      setSince(res.data.filters.since ?? "");
      setSavedId(res.data.id);
    }
    setLoading(false);
  }, [definitionId]);

  useEffect(() => {
    load();
  }, [load]);

  const buildPayload = () => ({
    name: name.trim(),
    type,
    layout: { sections },
    filters: { filters, since: since || undefined },
  });

  const onSave = async () => {
    setSaving(true);
    setActionError(null);
    const payload = buildPayload();
    const res = savedId
      ? await updateDefinition(savedId, payload)
      : await createDefinition(payload);
    if (res.error || !res.data) {
      setActionError(res.error ?? "Failed to save report.");
    } else {
      setSavedId(res.data.id);
    }
    setSaving(false);
  };

  const onRun = async () => {
    if (!savedId) return;
    setRunning(true);
    setActionError(null);
    const res = await runDefinition(savedId, "json");
    if (res.error || !res.data) {
      setActionError(res.error ?? "Failed to run report.");
    } else {
      setResult(res.data.result);
    }
    setRunning(false);
  };

  if (!canEdit) {
    return (
      <StateBlock
        kind="empty"
        message="You need editor access to build reports."
      />
    );
  }

  if (loading) {
    return <StateBlock kind="loading" message="Loading report..." />;
  }

  if (loadError) {
    return <StateBlock kind="error" message={loadError} onRetry={load} />;
  }

  return (
    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-lg border border-ink/15 bg-white p-4">
          <label
            htmlFor="report-name"
            className="block text-xs font-medium text-ink/50"
          >
            Report name
          </label>
          <input
            id="report-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Quarterly claims summary"
            className="mt-1 w-full rounded border border-ink/15 bg-white px-2 py-1.5 text-sm"
          />

          <label
            htmlFor="report-type-select"
            className="mt-3 block text-xs font-medium text-ink/50"
          >
            Type
          </label>
          <select
            id="report-type-select"
            value={type}
            onChange={(e) => setType(e.target.value as ReportType)}
            className="mt-1 rounded border border-ink/15 bg-white px-2 py-1.5 text-sm"
          >
            {REPORT_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        </div>

        <LayoutEditor sections={sections} onChange={setSections} />
        <FilterEditor
          filters={filters}
          since={since}
          onFiltersChange={setFilters}
          onSinceChange={setSince}
        />

        {actionError ? (
          <p className="text-sm text-red-700">{actionError}</p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || name.trim().length === 0}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : savedId ? "Save changes" : "Create report"}
          </button>
          {savedId ? (
            <button
              type="button"
              onClick={() => router.push(`/console/reporting/${savedId}`)}
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink/70 hover:bg-paper"
            >
              View runs
            </button>
          ) : null}
        </div>
      </div>

      <PreviewPanel
        name={name}
        type={type}
        sections={sections}
        filters={filters}
        since={since}
        result={result}
        running={running}
        saved={Boolean(savedId)}
        onRun={onRun}
      />
    </div>
  );
}

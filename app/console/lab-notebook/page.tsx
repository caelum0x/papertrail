"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capture } from "./_components/Capture";
import { StructuredPreview } from "./_components/StructuredPreview";
import { ExperimentList } from "./_components/ExperimentList";
import { ExperimentDetail } from "./_components/ExperimentDetail";
import {
  createExperiment,
  deleteExperiment,
  getExperiment,
  listExperiments,
  structureNotes,
} from "./_components/api";
import type {
  LabExperimentListItem,
  LabExperimentRecord,
  StructureResponse,
} from "./_components/types";

// LAB NOTEBOOK COMPANION console. Left: capture rough bench notes → structure with Claude
// (grounded to verbatim spans) → review + save. Right: full-text search over saved
// experiments with a detail view. Every panel handles loading, empty and error states.

const LIST_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export default function LabNotebookPage() {
  // --- Capture + structure (left) ---
  const [notes, setNotes] = useState("");
  const [structuring, setStructuring] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  // True when the failure is an honest upstream/degraded condition (Claude unavailable /
  // network) rather than a hard error — the UI renders it as a yellow, recoverable notice.
  const [structureDegraded, setStructureDegraded] = useState(false);
  const [preview, setPreview] = useState<StructureResponse | null>(null);

  // --- Save ---
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // --- Saved list (right) ---
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<LabExperimentListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // --- Detail ---
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LabExperimentRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadList = useCallback(async (q: string) => {
    setListLoading(true);
    setListError(null);
    const res = await listExperiments(1, LIST_LIMIT, q.trim() || undefined);
    if (res.error) {
      setListError(res.error);
      setItems([]);
    } else {
      setItems(res.data ?? []);
    }
    setListLoading(false);
  }, []);

  // Initial load.
  useEffect(() => {
    void loadList("");
  }, [loadList]);

  // Debounced search whenever the query changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadList(query);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, loadList]);

  const onStructure = useCallback(async () => {
    setStructuring(true);
    setStructureError(null);
    setStructureDegraded(false);
    setPreview(null);
    setSaveError(null);
    const res = await structureNotes(notes.trim());
    if (res.error || !res.data) {
      setStructureError(res.error ?? "Failed to structure notes.");
      // 503 (Claude usage-capped / overloaded) and 0 (no response reached) are honest,
      // recoverable degraded states — render them yellow, not as a red hard failure.
      setStructureDegraded(res.status === 503 || res.status === 0);
    } else {
      setPreview(res.data);
    }
    setStructuring(false);
  }, [notes]);

  const onSelect = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    const res = await getExperiment(id);
    if (res.error || !res.data) {
      setDetailError(res.error ?? "Failed to load experiment.");
    } else {
      setDetail(res.data);
    }
    setDetailLoading(false);
  }, []);

  const onSave = useCallback(
    async (input: { title: string; experimentDate: string | null; tags: string[] }) => {
      if (!preview) return;
      setSaving(true);
      setSaveError(null);
      const res = await createExperiment({
        title: input.title,
        experiment_date: input.experimentDate,
        raw_notes: notes.trim(),
        structured: preview.structured,
        tags: input.tags,
      });
      if (res.error || !res.data) {
        setSaveError(res.error ?? "Failed to save experiment.");
        setSaving(false);
        return;
      }
      // Reset the capture flow and surface the saved record on the right.
      setSaving(false);
      setPreview(null);
      setNotes("");
      setStructureError(null);
      await loadList(query);
      await onSelect(res.data.id);
    },
    [preview, notes, query, loadList, onSelect]
  );

  const onDelete = useCallback(
    async (id: string) => {
      setDeleting(true);
      const res = await deleteExperiment(id);
      if (res.error) {
        setDetailError(res.error);
        setDeleting(false);
        return;
      }
      setDeleting(false);
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await loadList(query);
    },
    [selectedId, query, loadList]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink/80">Lab Notebook Companion</h1>
        <p className="mt-1 text-sm text-ink/60">
          For bench scientists in translational, disease-focused labs: turn rough,
          dictated bench notes into a reproducible, searchable experiment record — no
          transcription labor.
        </p>
        <p className="mt-1 text-sm text-ink/40">
          Every reagent, protocol step, and outcome stays grounded to a verbatim quote
          from your exact words. Claude never invents a reagent or result you didn&rsquo;t
          write — anything it can&rsquo;t quote is dropped, not shown.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: capture → structure → review → save */}
        <div className="space-y-6">
          <Capture
            notes={notes}
            onChange={setNotes}
            onStructure={() => void onStructure()}
            loading={structuring}
            error={structureError}
            degraded={structureDegraded}
          />

          {preview ? (
            <StructuredPreview
              preview={preview}
              defaultTitle={preview.structured.suggested_title}
              defaultDate={preview.structured.suggested_date}
              onSave={onSave}
              saving={saving}
              saveError={saveError}
            />
          ) : null}
        </div>

        {/* Right: searchable saved experiments + detail */}
        <div className="space-y-6">
          <ExperimentList
            items={items}
            query={query}
            onQueryChange={setQuery}
            onSelect={(id) => void onSelect(id)}
            selectedId={selectedId}
            loading={listLoading}
            error={listError}
          />

          {selectedId ? (
            <ExperimentDetail
              record={detail}
              loading={detailLoading}
              error={detailError}
              onDelete={(id) => void onDelete(id)}
              deleting={deleting}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

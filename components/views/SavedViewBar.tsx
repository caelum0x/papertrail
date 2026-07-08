"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchViews,
  createView,
  type SavedViewDto,
  type ViewQuery,
  type ViewResource,
} from "./api";

interface SavedViewBarProps {
  // Which resource's views to load and save. Embed one bar per list page.
  resource: ViewResource;
  // The list page's current query — used when the user clicks "Save current".
  currentQuery: ViewQuery;
  // Called when the user picks a saved view so the host list page can apply it.
  onApply: (view: SavedViewDto) => void;
  // Currently applied view id, if any (e.g. from the URL), to show as selected.
  activeViewId?: string | null;
}

// Embeddable control for list pages: a dropdown to pick a saved view plus an
// inline "Save current" affordance. Loads the org's views for the given resource
// (own + shared) and lets the user persist the page's current query as a new one.
// Self-contained: owns its own loading/empty/error state.
export function SavedViewBar({
  resource,
  currentQuery,
  onApply,
  activeViewId,
}: SavedViewBarProps) {
  const [views, setViews] = useState<SavedViewDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShared, setNewShared] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchViews({ resource, limit: 100 });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load views.");
      setLoading(false);
      return;
    }
    setViews(res.data);
    setLoading(false);
  }, [resource]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePick = (id: string) => {
    if (!id) return;
    const view = views.find((v) => v.id === id);
    if (view) {
      onApply(view);
    }
  };

  const handleSave = async () => {
    if (!newName.trim()) {
      setSaveError("Name the view first.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const res = await createView({
      name: newName.trim(),
      resource,
      query: currentQuery,
      shared: newShared,
    });
    setSaving(false);
    if (!res.success || !res.data) {
      setSaveError(res.error ?? "Failed to save view.");
      return;
    }
    setViews((prev) => [res.data as SavedViewDto, ...prev]);
    setNewName("");
    setNewShared(false);
    setSaveOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs uppercase tracking-wide text-ink/40">View</label>

      {loading ? (
        <span className="text-sm text-ink/40">Loading views...</span>
      ) : error ? (
        <span className="flex items-center gap-2 text-sm text-red-600">
          {error}
          <button
            type="button"
            onClick={() => void load()}
            className="text-accent hover:underline"
          >
            Retry
          </button>
        </span>
      ) : (
        <select
          value={activeViewId ?? ""}
          onChange={(e) => handlePick(e.target.value)}
          className="rounded border border-ink/15 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">
            {views.length === 0 ? "No saved views" : "Select a view..."}
          </option>
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.shared && !v.isOwner ? " (shared)" : ""}
            </option>
          ))}
        </select>
      )}

      {saveOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="View name"
            className="rounded border border-ink/15 px-2 py-1.5 text-sm"
          />
          <label className="flex items-center gap-1 text-xs text-ink/60">
            <input
              type="checkbox"
              checked={newShared}
              onChange={(e) => setNewShared(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Shared
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSaveOpen(false);
              setSaveError(null);
            }}
            className="text-sm text-ink/50 hover:underline"
          >
            Cancel
          </button>
          {saveError ? (
            <span className="text-sm text-red-600">{saveError}</span>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSaveOpen(true)}
          className="text-sm text-accent hover:underline"
        >
          Save current
        </button>
      )}
    </div>
  );
}

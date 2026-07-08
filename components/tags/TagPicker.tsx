"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TagBadge from "./TagBadge";
import {
  fetchTags,
  fetchEntityTags,
  attachTag,
  detachTag,
  type TagDto,
  type TaggableEntityType,
} from "./api";

// Reusable tag picker other modules embed on any entity's detail view. Loads the
// entity's current tags + the org vocabulary, and attaches/detaches on the fly.
// Fully self-contained with loading/empty/error states.

interface TagPickerProps {
  entityType: TaggableEntityType;
  entityId: string;
  onChange?: (tags: TagDto[]) => void;
}

export default function TagPicker({ entityType, entityId, onChange }: TagPickerProps) {
  const [selected, setSelected] = useState<TagDto[]>([]);
  const [vocabulary, setVocabulary] = useState<TagDto[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [current, vocab] = await Promise.all([
      fetchEntityTags(entityType, entityId),
      fetchTags({ limit: 100 }),
    ]);
    if (!current.success || !current.data) {
      setError(current.error ?? "Failed to load tags.");
      setLoading(false);
      return;
    }
    setSelected(current.data);
    setVocabulary(vocab.success && vocab.data ? vocab.data : []);
    setLoading(false);
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const selectedIds = useMemo(
    () => new Set(selected.map((t) => t.id)),
    [selected]
  );

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vocabulary
      .filter((t) => !selectedIds.has(t.id))
      .filter((t) => (q ? t.name.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [vocabulary, selectedIds, query]);

  const commit = useCallback(
    (next: TagDto[]) => {
      setSelected(next);
      onChange?.(next);
    },
    [onChange]
  );

  const handleAttach = useCallback(
    async (tag: TagDto) => {
      setBusy(true);
      setError(null);
      const res = await attachTag({ tagId: tag.id, entityType, entityId });
      if (!res.success) {
        setError(res.error ?? "Failed to attach tag.");
        setBusy(false);
        return;
      }
      commit([...selected, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setQuery("");
      setBusy(false);
    },
    [entityType, entityId, selected, commit]
  );

  const handleDetach = useCallback(
    async (tag: TagDto) => {
      setBusy(true);
      setError(null);
      const res = await detachTag({ tagId: tag.id, entityType, entityId });
      if (!res.success) {
        setError(res.error ?? "Failed to remove tag.");
        setBusy(false);
        return;
      }
      commit(selected.filter((t) => t.id !== tag.id));
      setBusy(false);
    },
    [entityType, entityId, selected, commit]
  );

  if (loading) {
    return <p className="text-sm text-ink/40">Loading tags…</p>;
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.length === 0 ? (
          <span className="text-sm text-ink/40">No tags yet</span>
        ) : (
          selected.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              size="sm"
              onRemove={busy ? undefined : () => void handleDetach(tag)}
            />
          ))
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          className="text-xs border border-ink/15 rounded-full px-2 py-0.5 text-ink/60 hover:border-accent disabled:opacity-50"
        >
          + Add tag
        </button>
      </div>

      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}

      {open ? (
        <div className="absolute z-10 mt-2 w-64 rounded-lg border border-ink/10 bg-white p-2 shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tags…"
            className="w-full rounded border border-ink/15 px-2 py-1 text-sm outline-none focus:border-accent"
          />
          <div className="mt-2 max-h-48 overflow-auto">
            {candidates.length === 0 ? (
              <p className="px-1 py-2 text-xs text-ink/40">
                {vocabulary.length === 0
                  ? "No tags in this organization yet."
                  : "No matches."}
              </p>
            ) : (
              candidates.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => void handleAttach(tag)}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-paper disabled:opacity-50"
                >
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-ink/80">{tag.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

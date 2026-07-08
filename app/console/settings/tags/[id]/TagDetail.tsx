"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateTag,
  deleteTag,
  type TagDto,
} from "@/components/tags/api";

// Detail header + inline editor for a single tag. Composes a DetailHeader area
// and an edit panel (name, color, parent). Parent options exclude the tag itself.

const PRESET_COLORS = [
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

interface TagDetailProps {
  tag: TagDto;
  parents: TagDto[];
  onUpdated: (tag: TagDto) => void;
}

export default function TagDetail({ tag, parents, onUpdated }: TagDetailProps) {
  const router = useRouter();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [parentId, setParentId] = useState<string>(tag.parentId ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const parentOptions = parents.filter((p) => p.id !== tag.id);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    const res = await updateTag(tag.id, {
      name: trimmed,
      color,
      parentId: parentId || null,
    });
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to save.");
      setSaving(false);
      return;
    }
    onUpdated(res.data);
    setNotice("Saved.");
    setSaving(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    const res = await deleteTag(tag.id);
    if (!res.success) {
      setError(res.error ?? "Failed to delete.");
      setDeleting(false);
      return;
    }
    router.push("/console/settings/tags");
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-4 w-4 rounded-full"
          style={{ backgroundColor: tag.color }}
        />
        <h1 className="text-2xl font-semibold text-ink/80">{tag.name}</h1>
        <span className="text-xs text-ink/40">
          {tag.usageCount ?? 0} {tag.usageCount === 1 ? "use" : "uses"}
        </span>
      </div>

      <form
        onSubmit={handleSave}
        className="mt-6 max-w-md rounded-lg border border-ink/10 bg-white p-4"
      >
        <h2 className="text-sm font-medium text-ink/80">Edit tag</h2>

        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-ink/60" htmlFor="edit-name">
              Name
            </label>
            <input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="mt-1 w-full rounded border border-ink/15 px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>

          <div>
            <span className="block text-xs font-medium text-ink/60">Color</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`h-6 w-6 rounded-full border-2 ${
                    color === c ? "border-ink/60" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink/60" htmlFor="edit-parent">
              Parent
            </label>
            <select
              id="edit-parent"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="mt-1 w-full rounded border border-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              <option value="">— None (top level) —</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          {notice ? <p className="text-xs text-green-600">{notice}</p> : null}

          <div className="flex items-center justify-between">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-accent px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm text-ink/40 hover:text-red-600 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete tag"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
